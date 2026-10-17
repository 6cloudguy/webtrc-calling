import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer from 'peerjs';
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  Phone,
  PhoneOff,
  PhoneIncoming,
  Monitor,
  MonitorOff,
  SwitchCamera,
  Copy,
  Check,
  LayoutGrid,
  Maximize,
  Minimize,
  Clock,
  Sparkles,
  Share2,
  Plus,
} from 'lucide-react';

import VideoTile from './components/VideoTile';
import {
  startRingtone,
  stopRingtone,
  playConnectChime,
  playDisconnectChime,
} from './utils/audioEffects';

// List of high-availability STUN servers for NAT traversal
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export default function App() {
  // Streams
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  // Connection & Room state
  const [myPeerId, setMyPeerId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [isHost, setIsHost] = useState(true);
  const [directDialInput, setDirectDialInput] = useState('');
  const [callStatus, setCallStatus] = useState('Idle'); // 'Idle' | 'Calling' | 'Connected' | 'Incoming'
  const [incomingCallData, setIncomingCallData] = useState(null);
  const [callDuration, setCallDuration] = useState(0);

  // Controls state
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isFacingUser, setIsFacingUser] = useState(true);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [layoutMode, setLayoutMode] = useState('pip'); // 'pip' | 'grid'
  const [isSwapped, setIsSwapped] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Feedback state
  const [toastMessage, setToastMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  // Refs
  const peerRef = useRef(null);
  const activeCallRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const stageRef = useRef(null);
  const toastTimerRef = useRef(null);
  const callTimeoutRef = useRef(null);

  // Navigate to clean new room
  const handleCreateNewRoom = () => {
    const newRoom = 'room-' + Math.random().toString(36).substring(2, 8);
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${newRoom}`;
    window.location.href = newUrl;
  };

  // Toast notifier
  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage('');
    }, 2800);
  }, []);

  // Format call duration MM:SS
  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Call timer interval
  useEffect(() => {
    let interval;
    if (callStatus === 'Connected') {
      setCallDuration(0);
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  // Check if device has multiple cameras (mobile front/rear)
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setHasMultipleCameras(videoInputs.length > 1);
    }).catch(() => {});
  }, []);

  // Initialize local webcam / mic
  const initLocalStream = useCallback(async (facingMode = 'user') => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      // If already in a call, replace tracks on the WebRTC connection
      if (activeCallRef.current?.peerConnection) {
        const videoTrack = stream.getVideoTracks()[0];
        const senders = activeCallRef.current.peerConnection.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
        if (videoSender && videoTrack) {
          videoSender.replaceTrack(videoTrack);
        }
      }
      return stream;
    } catch (err) {
      console.error('Camera/Mic initialization failed:', err);
      setErrorMessage(
        'Unable to access camera or microphone. Please check permissions.'
      );
      return null;
    }
  }, []);

  // Initialize Peer and Room
  useEffect(() => {
    let peer = null;
    let heartbeatTimer = null;

    async function setupRoomAndPeer() {
      // 1. Get initial media stream
      const stream = await initLocalStream('user');

      // 2. Parse room name from query param or generate friendly room name
      const params = new URLSearchParams(window.location.search);
      let currentRoom = params.get('room');

      if (!currentRoom) {
        currentRoom = 'room-' + Math.random().toString(36).substring(2, 8);
        const newUrl = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
        window.history.replaceState(null, '', newUrl);
      }
      setRoomName(currentRoom);

      const targetHostId = `vcr-${currentRoom}-host`;

      function attachPeerListeners(p, isAttemptingHost) {
        p.on('call', (incoming) => {
          startRingtone();
          setIncomingCallData(incoming);
          setCallStatus('Incoming');
        });

        p.on('disconnected', () => {
          console.log('Peer disconnected from signaling server, reconnecting...');
          if (!p.destroyed) {
            p.reconnect();
          }
        });

        p.on('error', (err) => {
          console.warn('Peer error:', err.type, err);
          if (err.type === 'unavailable-id') {
            if (isAttemptingHost) {
              // Host is already active in this room! Reconnect cleanly as guest
              const guestId = `vcr-${currentRoom}-guest-${Math.random().toString(36).substring(2, 6)}`;
              p.destroy();
              const guestPeer = new Peer(guestId, { config: { iceServers: ICE_SERVERS } });
              guestPeer.on('open', (newId) => {
                setMyPeerId(newId);
                peerRef.current = guestPeer;
                setIsHost(false);
                showToast(`Ready to join room '${currentRoom}'`);
              });
              attachPeerListeners(guestPeer, false);
              peerRef.current = guestPeer;
              return;
            }
          }

          if (err.type === 'peer-unavailable') {
            stopRingtone();
            if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
            if (activeCallRef.current) {
              activeCallRef.current.close();
              activeCallRef.current = null;
            }
            setCallStatus('Idle');
            setErrorMessage('The host is not currently online in this room. Please make sure they have opened the room link.');
            showToast('Host is not online');
            return;
          }

          setErrorMessage(`Connection notice: ${err.message || err.type}`);
        });
      }

      // Try registering as host first
      peer = new Peer(targetHostId, {
        config: { iceServers: ICE_SERVERS },
      });

      peer.on('open', (id) => {
        setMyPeerId(id);
        setIsHost(true);
        console.log('Peer connected as host with ID:', id);
      });

      attachPeerListeners(peer, true);
      peerRef.current = peer;

      // 3. Heartbeat to keep PeerJS cloud WebSocket alive & reconnect if disconnected
      heartbeatTimer = setInterval(() => {
        if (peerRef.current && !peerRef.current.destroyed) {
          if (peerRef.current.disconnected) {
            peerRef.current.reconnect();
          }
        }
      }, 15000);
    }

    setupRoomAndPeer();

    return () => {
      stopRingtone();
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (activeCallRef.current) activeCallRef.current.close();
      if (peerRef.current) peerRef.current.destroy();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Initiate call
  const initiateCall = (remoteId, currentLocalStream, peerInstanceOverride) => {
    const p = peerInstanceOverride || peerRef.current;
    if (!remoteId || !p) return;

    if (remoteId === p.id || remoteId === myPeerId) {
      showToast('Cannot call yourself. Open the link on another device or tab.');
      return;
    }

    setCallStatus('Calling');
    setErrorMessage('');
    startRingtone();

    const streamToSend = currentLocalStream || localStreamRef.current;
    const call = p.call(remoteId, streamToSend);

    if (!call) {
      stopRingtone();
      setCallStatus('Idle');
      setErrorMessage('Could not initiate call to peer.');
      return;
    }

    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    callTimeoutRef.current = setTimeout(() => {
      if (callStatus === 'Calling' || activeCallRef.current) {
        stopRingtone();
        showToast('No answer from peer');
        handleCallEnd();
      }
    }, 30000);

    bindCallEvents(call);
    activeCallRef.current = call;
  };

  // Bind call stream events
  const bindCallEvents = (call) => {
    call.on('stream', (incomingStream) => {
      stopRingtone();
      if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
      playConnectChime();
      setRemoteStream(incomingStream);
      setCallStatus('Connected');
      showToast('Connected with peer');
    });

    call.on('close', () => {
      handleCallEnd();
    });

    call.on('error', (err) => {
      console.error('Call runtime error:', err);
      handleCallEnd();
    });
  };

  // Answer incoming call
  const answerIncomingCall = () => {
    if (!incomingCallData) return;

    stopRingtone();
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    const stream = localStreamRef.current;
    incomingCallData.answer(stream);

    bindCallEvents(incomingCallData);
    activeCallRef.current = incomingCallData;
    setCallStatus('Connected');
    setIncomingCallData(null);
  };

  // Reject incoming call
  const rejectIncomingCall = () => {
    stopRingtone();
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    if (incomingCallData) {
      incomingCallData.close();
      setIncomingCallData(null);
    }
    setCallStatus('Idle');
    showToast('Call declined');
  };

  // End active call
  const handleCallEnd = () => {
    stopRingtone();
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    playDisconnectChime();
    if (isScreenSharing) {
      stopScreenShare();
    }
    if (activeCallRef.current) {
      activeCallRef.current.close();
      activeCallRef.current = null;
    }
    setRemoteStream(null);
    setCallStatus('Idle');
    setIncomingCallData(null);
    showToast('Call ended');
  };

  // Toggle Microphone
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextState = !isAudioMuted;
        audioTracks.forEach((t) => (t.enabled = !nextState));
        setIsAudioMuted(nextState);
        showToast(nextState ? 'Microphone muted' : 'Microphone active');
      }
    }
  };

  // Toggle Camera
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        const nextState = !isVideoMuted;
        videoTracks.forEach((t) => (t.enabled = !nextState));
        setIsVideoMuted(nextState);
        showToast(nextState ? 'Camera turned off' : 'Camera turned on');
      }
    }
  };

  // Flip Mobile Camera (Front / Back)
  const flipCamera = async () => {
    if (isScreenSharing) return;
    const nextMode = isFacingUser ? 'environment' : 'user';
    setIsFacingUser(!isFacingUser);
    showToast(`Switched to ${nextMode === 'user' ? 'front' : 'rear'} camera`);
    await initLocalStream(nextMode);
  };

  // Screen Share Toggle
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        const screenTrack = screenStream.getVideoTracks()[0];
        screenStreamRef.current = screenStream;

        // Temporarily replace local preview with screen share
        setLocalStream(screenStream);

        // Replace track on WebRTC sender
        if (activeCallRef.current?.peerConnection) {
          const senders = activeCallRef.current.peerConnection.getSenders();
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(screenTrack);
          }
        }

        screenTrack.onended = () => {
          stopScreenShare();
        };

        setIsScreenSharing(true);
        showToast('Screen sharing started');
      } catch (err) {
        console.warn('Screen share cancelled/not supported:', err);
      }
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    // Revert to webcam
    if (localStreamRef.current) {
      setLocalStream(localStreamRef.current);
      const webcamTrack = localStreamRef.current.getVideoTracks()[0];
      if (activeCallRef.current?.peerConnection && webcamTrack) {
        const senders = activeCallRef.current.peerConnection.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(webcamTrack);
        }
      }
    }
    setIsScreenSharing(false);
    showToast('Screen sharing stopped');
  };

  // Fullscreen Toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      stageRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  // Copy shareable room link
  const copyRoomLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomName}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    showToast('Room link copied! Send it to your friend to join.');
    setTimeout(() => setLinkCopied(false), 2200);
  };

  // Main vs PiP components calculation
  const showMainStream = isSwapped ? localStream : remoteStream;
  const showMainLabel = isSwapped ? 'You' : 'Peer';
  const showMainIsLocal = isSwapped;
  const showMainAudioMuted = isSwapped ? isAudioMuted : false;
  const showMainVideoMuted = isSwapped ? isVideoMuted : false;

  const showPipStream = isSwapped ? remoteStream : localStream;
  const showPipLabel = isSwapped ? 'Peer' : 'You';
  const showPipIsLocal = !isSwapped;
  const showPipAudioMuted = !isSwapped ? isAudioMuted : false;
  const showPipVideoMuted = !isSwapped ? isVideoMuted : false;

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">
            <VideoIcon size={19} />
          </div>
          <div className="brand-text">
            <h1>WebRTC Meet</h1>
          </div>
        </div>

        <div className="header-status-area">
          {callStatus === 'Connected' && (
            <div className="call-timer">
              <Clock size={13} />
              <span>{formatTimer(callDuration)}</span>
            </div>
          )}

          <div
            className={`status-badge ${
              callStatus === 'Connected'
                ? 'connected'
                : callStatus === 'Calling' || callStatus === 'Incoming'
                ? 'calling'
                : ''
            }`}
          >
            <span className="status-dot"></span>
            <span>
              {callStatus === 'Connected'
                ? 'In Call'
                : callStatus === 'Calling'
                ? 'Calling...'
                : callStatus === 'Incoming'
                ? 'Incoming Call'
                : isHost
                ? 'Waiting for Peer'
                : 'Ready to Join'}
            </span>
          </div>
        </div>
      </header>

      {/* Incoming Call Notification Banner */}
      {incomingCallData && (
        <div className="incoming-call-banner">
          <div className="incoming-call-info">
            <h4>Incoming Call</h4>
            <span>Peer is calling you...</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-action-primary"
              style={{ background: '#10b981' }}
              onClick={answerIncomingCall}
            >
              <PhoneIncoming size={15} /> Accept
            </button>
            <button
              className="btn-action-primary"
              style={{ background: '#ef4444' }}
              onClick={rejectIncomingCall}
            >
              <PhoneOff size={15} /> Decline
            </button>
          </div>
        </div>
      )}

      {/* Room & Share Action Bar */}
      <div className="action-bar">
        {/* Room Info & Instant Link Sharing */}
        <div className="room-info-pill">
          <span className="room-label">Room:</span>
          <span className="room-tag" title={roomName}>
            {roomName || 'Creating...'}
          </span>
          <button
            className="btn-action-primary"
            onClick={copyRoomLink}
            title="Copy shareable link"
          >
            {linkCopied ? <Check size={14} /> : <Share2 size={14} />}
            <span>{linkCopied ? 'Link Copied!' : 'Share Room Link'}</span>
          </button>

          {!isHost && callStatus === 'Idle' && (
            <button
              className="btn-action-primary btn-join-room"
              onClick={() => initiateCall(`vcr-${roomName}-host`)}
              title="Join room call"
            >
              <Phone size={14} />
              <span>Join Room</span>
            </button>
          )}

          <button
            className="btn-action-secondary"
            onClick={handleCreateNewRoom}
            title="Create a fresh room"
          >
            <Plus size={14} />
            <span>New Room</span>
          </button>
        </div>

        {/* Direct Peer Dial option */}
        <div className="direct-call-group">
          <input
            type="text"
            className="direct-input"
            placeholder="Or dial Peer ID directly..."
            value={directDialInput}
            onChange={(e) => setDirectDialInput(e.target.value)}
            disabled={callStatus === 'Connected' || callStatus === 'Calling'}
          />
          {callStatus === 'Connected' || callStatus === 'Calling' ? (
            <button
              className="btn-action-primary"
              style={{ background: '#ef4444' }}
              onClick={handleCallEnd}
            >
              <PhoneOff size={15} /> End
            </button>
          ) : (
            <button
              className="btn-action-secondary"
              onClick={() => initiateCall(directDialInput)}
              disabled={!directDialInput}
            >
              <Phone size={14} /> Call
            </button>
          )}
        </div>
      </div>

      {/* Video Stage Area */}
      <main className="stage-area" ref={stageRef}>
        {callStatus === 'Idle' ? (
          /* Idle Lobby Preview */
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div className="idle-overlay-guide">
              <Sparkles size={14} color="#38bdf8" />
              <span>
                {isHost
                  ? "You are hosting this room. Share the room link to invite someone to talk!"
                  : `You're ready to join ${roomName}. Click "Join Room" when ready!`}
              </span>
            </div>

            {!isHost && (
              <div className="lobby-join-card">
                <h3>Ready to join?</h3>
                <p>Room: <span className="room-highlight">{roomName}</span></p>
                <div className="lobby-join-actions">
                  <button
                    className="btn-action-primary btn-hero-join"
                    onClick={() => initiateCall(`vcr-${roomName}-host`)}
                  >
                    <Phone size={17} /> Join Room
                  </button>
                  <button
                    className="btn-action-secondary"
                    onClick={handleCreateNewRoom}
                  >
                    <Plus size={14} /> Start New Room
                  </button>
                </div>
              </div>
            )}

            <VideoTile
              stream={localStream}
              label="You (Preview)"
              isLocal={true}
              isAudioMuted={isAudioMuted}
              isVideoMuted={isVideoMuted}
              isScreenSharing={isScreenSharing}
            />
          </div>
        ) : layoutMode === 'grid' ? (
          /* Grid Mode: Side-by-Side */
          <div className="stage-grid">
            <VideoTile
              stream={localStream}
              label="You"
              isLocal={true}
              isAudioMuted={isAudioMuted}
              isVideoMuted={isVideoMuted}
              isScreenSharing={isScreenSharing}
            />
            <VideoTile
              stream={remoteStream}
              label="Peer"
              isLocal={false}
              peerStatus={callStatus === 'Calling' ? 'Calling peer...' : 'Connecting...'}
            />
          </div>
        ) : (
          /* Spotlight / PiP Mode */
          <div className="stage-pip">
            {/* Main Full-Size Video */}
            <div className="main-view">
              <VideoTile
                stream={showMainStream}
                label={showMainLabel}
                isLocal={showMainIsLocal}
                isAudioMuted={showMainAudioMuted}
                isVideoMuted={showMainVideoMuted}
                isScreenSharing={showMainIsLocal && isScreenSharing}
                peerStatus={callStatus === 'Calling' ? 'Calling peer...' : 'Connecting...'}
              />
            </div>

            {/* Floating PiP Thumbnail */}
            <div
              className="pip-overlay"
              onClick={() => setIsSwapped(!isSwapped)}
              title="Tap to swap screens"
            >
              <VideoTile
                stream={showPipStream}
                label={showPipLabel}
                isLocal={showPipIsLocal}
                isAudioMuted={showPipAudioMuted}
                isVideoMuted={showPipVideoMuted}
                isScreenSharing={showPipIsLocal && isScreenSharing}
                isPip={true}
              />
            </div>
          </div>
        )}

        {/* Floating Controls Dock */}
        <div className="control-dock">
          {/* Mute Mic */}
          <button
            className={`dock-btn ${isAudioMuted ? 'is-danger' : ''}`}
            onClick={toggleAudio}
            title={isAudioMuted ? 'Unmute Mic' : 'Mute Mic'}
          >
            {isAudioMuted ? <MicOff size={19} /> : <Mic size={19} />}
          </button>

          {/* Toggle Video */}
          <button
            className={`dock-btn ${isVideoMuted ? 'is-danger' : ''}`}
            onClick={toggleVideo}
            title={isVideoMuted ? 'Start Video' : 'Stop Video'}
          >
            {isVideoMuted ? <VideoOff size={19} /> : <VideoIcon size={19} />}
          </button>

          {/* Flip Mobile Camera (Front / Rear) */}
          {hasMultipleCameras && (
            <button
              className="dock-btn"
              onClick={flipCamera}
              title="Flip Camera (Front/Rear)"
            >
              <SwitchCamera size={19} />
            </button>
          )}

          {/* Screen Share (Desktop / Supported Browsers) */}
          {navigator.mediaDevices?.getDisplayMedia && (
            <button
              className={`dock-btn ${isScreenSharing ? 'is-active' : ''}`}
              onClick={toggleScreenShare}
              title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
            >
              {isScreenSharing ? <MonitorOff size={19} /> : <Monitor size={19} />}
            </button>
          )}

          {/* Layout Toggle (PiP / Grid) */}
          {callStatus !== 'Idle' && (
            <button
              className={`dock-btn ${layoutMode === 'grid' ? 'is-active' : ''}`}
              onClick={() => setLayoutMode(layoutMode === 'pip' ? 'grid' : 'pip')}
              title={layoutMode === 'pip' ? 'Grid View' : 'Spotlight View'}
            >
              <LayoutGrid size={19} />
            </button>
          )}

          {/* Fullscreen */}
          <button
            className="dock-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>

          {/* Leave Call */}
          {(callStatus === 'Connected' || callStatus === 'Calling') && (
            <button
              className="dock-btn leave-btn"
              onClick={handleCallEnd}
              title="Leave Call"
            >
              <PhoneOff size={18} />
              <span>Leave</span>
            </button>
          )}
        </div>
      </main>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="app-toast">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Error Toast Notification */}
      {errorMessage && (
        <div className="app-toast error-toast">
          <span>{errorMessage}</span>
          <button className="toast-close" onClick={() => setErrorMessage('')}>×</button>
        </div>
      )}
    </div>
  );
}
