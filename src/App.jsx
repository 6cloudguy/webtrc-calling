import React, { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  Phone,
  PhoneOff,
  PhoneCall,
  PhoneIncoming,
  Monitor,
  MonitorOff,
  Copy,
  Check,
  LayoutGrid,
  Maximize,
  Minimize,
  Clock,
  ArrowLeftRight,
} from 'lucide-react';

export default function App() {
  const [peerId, setPeerId] = useState('');
  const [remotePeerIdValue, setRemotePeerIdValue] = useState('');
  const [callStatus, setCallStatus] = useState('Idle'); // 'Idle' | 'Calling' | 'Connected' | 'Incoming'
  const [incomingCall, setIncomingCall] = useState(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [layoutMode, setLayoutMode] = useState('pip'); // 'pip' | 'grid'
  const [isSwapped, setIsSwapped] = useState(false); // for PiP swap main vs thumbnail
  const [callDuration, setCallDuration] = useState(0);
  const [toastMessage, setToastMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerInstance = useRef(null);
  const currentCall = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const stageContainerRef = useRef(null);
  const toastTimeoutRef = useRef(null);

  // Helper: show brief toast
  const showToast = (msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage('');
    }, 2800);
  };

  // Timer for active call
  useEffect(() => {
    let timer;
    if (callStatus === 'Connected') {
      setCallDuration(0);
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(timer);
  }, [callStatus]);

  // Format call duration MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Initialize Media Devices & PeerJS on mount
  useEffect(() => {
    let peer = null;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Media devices error:', err);
        setErrorMessage(
          'Camera/Microphone permission denied or device not found. Please allow access.'
        );
      }

      peer = new Peer({
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
        },
      });

      peer.on('open', (id) => {
        setPeerId(id);

        const params = new URLSearchParams(window.location.search);
        const targetId = params.get('call');
        if (targetId && targetId !== id) {
          setRemotePeerIdValue(targetId);
          showToast(`Invite from peer detected. Click 'Call' to connect!`);
        }
      });

      peer.on('call', (call) => {
        setIncomingCall(call);
        setCallStatus('Incoming');
      });

      peer.on('error', (err) => {
        console.error('Peer error:', err);
        setErrorMessage(`Peer connection error: ${err.type || err.message}`);
      });

      peerInstance.current = peer;
    }

    init();

    return () => {
      if (currentCall.current) currentCall.current.close();
      if (peerInstance.current) peerInstance.current.destroy();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Answer incoming call
  const answerCall = () => {
    if (!incomingCall) return;

    incomingCall.answer(localStreamRef.current);

    incomingCall.on('stream', (remoteStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    });

    incomingCall.on('close', () => {
      endCall();
    });

    currentCall.current = incomingCall;
    setCallStatus('Connected');
    setIncomingCall(null);
    showToast('Call connected');
  };

  // Reject incoming call
  const rejectCall = () => {
    if (incomingCall) {
      incomingCall.close();
      setIncomingCall(null);
      setCallStatus('Idle');
      showToast('Call declined');
    }
  };

  // Dial a peer
  const callPeer = (remoteId) => {
    if (!remoteId || !peerInstance.current) return;
    setCallStatus('Calling');
    setErrorMessage('');

    const call = peerInstance.current.call(remoteId, localStreamRef.current);

    if (!call) {
      setErrorMessage('Could not initiate call to peer.');
      setCallStatus('Idle');
      return;
    }

    call.on('stream', (remoteStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      setCallStatus('Connected');
      showToast('Peer joined call');
    });

    call.on('close', () => {
      endCall();
      showToast('Call ended by peer');
    });

    call.on('error', (err) => {
      console.error('Call error:', err);
      setErrorMessage(`Call error: ${err.message || 'connection failed'}`);
      endCall();
    });

    currentCall.current = call;
  };

  // End active call
  const endCall = () => {
    if (isScreenSharing) {
      stopScreenShare();
    }
    if (currentCall.current) {
      currentCall.current.close();
      currentCall.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setCallStatus('Idle');
    setIncomingCall(null);
  };

  // Audio Toggle
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextState = !isAudioMuted;
        audioTracks.forEach((t) => (t.enabled = !nextState));
        setIsAudioMuted(nextState);
        showToast(nextState ? 'Microphone muted' : 'Microphone unmuted');
      }
    }
  };

  // Video Toggle
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        const nextState = !isVideoMuted;
        videoTracks.forEach((t) => (t.enabled = !nextState));
        setIsVideoMuted(nextState);
        showToast(nextState ? 'Camera stopped' : 'Camera started');
      }
    }
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

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        // Replace track on WebRTC connection if in call
        if (currentCall.current && currentCall.current.peerConnection) {
          const senders = currentCall.current.peerConnection.getSenders();
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
        console.warn('Screen share canceled/failed:', err);
      }
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (localStreamRef.current) {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      const webcamTrack = localStreamRef.current.getVideoTracks()[0];
      if (currentCall.current && currentCall.current.peerConnection && webcamTrack) {
        const senders = currentCall.current.peerConnection.getSenders();
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
      stageContainerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  // Copy shareable link
  const copyShareLink = () => {
    if (!peerId) return;
    const url = `${window.location.origin}${window.location.pathname}?call=${peerId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    showToast('Invite link copied to clipboard!');
    setTimeout(() => setCopied(false), 2200);
  };

  // Render Video Component
  const renderLocalVideo = (isPipThumb = false) => (
    <div
      className={`video-card ${isPipThumb ? 'pip-thumbnail' : ''}`}
      onClick={isPipThumb ? () => setIsSwapped(!isSwapped) : undefined}
      title={isPipThumb ? 'Click to swap video' : ''}
    >
      <video
        ref={localVideoRef}
        autoPlay
        playsInline
        muted
        className={`video-element ${!isScreenSharing ? 'mirrored' : ''}`}
        style={{ display: isVideoMuted ? 'none' : 'block' }}
      />
      {isVideoMuted && (
        <div className="video-off-avatar">
          <div className="avatar-circle">YOU</div>
          <span style={{ fontSize: '0.85rem' }}>Camera Off</span>
        </div>
      )}
      <div className="video-overlay-bottom">
        <span className={`mic-badge ${isAudioMuted ? 'muted' : ''}`}>
          {isAudioMuted ? <MicOff size={14} /> : <Mic size={14} />}
        </span>
        <span>You {isScreenSharing ? '(Screen)' : ''}</span>
        {isPipThumb && <ArrowLeftRight size={12} style={{ marginLeft: '4px', opacity: 0.7 }} />}
      </div>
    </div>
  );

  const renderRemoteVideo = (isPipThumb = false) => (
    <div
      className={`video-card ${isPipThumb ? 'pip-thumbnail' : ''}`}
      onClick={isPipThumb ? () => setIsSwapped(!isSwapped) : undefined}
      title={isPipThumb ? 'Click to swap video' : ''}
    >
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="video-element"
        style={{ display: callStatus === 'Connected' ? 'block' : 'none' }}
      />
      {callStatus !== 'Connected' && (
        <div className="video-off-avatar">
          <div className="avatar-circle avatar-pulsing">
            {callStatus === 'Calling' ? <PhoneCall size={32} /> : 'PEER'}
          </div>
          <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
            {callStatus === 'Calling'
              ? 'Ringing peer...'
              : 'Waiting for peer to connect...'}
          </span>
        </div>
      )}
      <div className="video-overlay-bottom">
        <span className="mic-badge">
          <Mic size={14} />
        </span>
        <span>
          {callStatus === 'Connected'
            ? 'Peer'
            : callStatus === 'Calling'
            ? 'Calling...'
            : 'Remote Peer'}
        </span>
        {isPipThumb && <ArrowLeftRight size={12} style={{ marginLeft: '4px', opacity: 0.7 }} />}
      </div>
    </div>
  );

  return (
    <div className="app-viewport">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">
            <VideoIcon size={20} />
          </div>
          <div>
            <h1 className="brand-title">WebRTC Connect</h1>
          </div>
        </div>

        <div className="header-meta">
          {callStatus === 'Connected' && (
            <div className="timer-badge">
              <Clock size={15} />
              <span>{formatTime(callDuration)}</span>
            </div>
          )}

          <div
            className={`status-pill ${
              callStatus === 'Connected'
                ? 'online'
                : callStatus === 'Calling' || callStatus === 'Incoming'
                ? 'calling'
                : ''
            }`}
          >
            <span className="status-dot"></span>
            <span>
              {callStatus === 'Connected'
                ? 'Connected'
                : callStatus === 'Calling'
                ? 'Calling...'
                : callStatus === 'Incoming'
                ? 'Incoming Call'
                : 'Ready'}
            </span>
          </div>
        </div>
      </header>

      {/* Incoming Call Notification Banner */}
      {incomingCall && (
        <div className="incoming-call-card">
          <div className="incoming-call-info">
            <span className="incoming-call-title">Incoming Video Call</span>
            <span className="incoming-call-caller">{incomingCall.peer}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              className="btn-primary"
              style={{ background: '#10b981' }}
              onClick={answerCall}
            >
              <PhoneIncoming size={16} /> Accept
            </button>
            <button
              className="btn-primary"
              style={{ background: '#ef4444' }}
              onClick={rejectCall}
            >
              <PhoneOff size={16} /> Decline
            </button>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '0.5rem',
            padding: '0.75rem 1rem',
            color: '#f87171',
            fontSize: '0.875rem',
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* Lobby / Dial Bar */}
      <div className="lobby-bar">
        {/* Left: Your ID & Link */}
        <div className="my-id-box">
          <span className="id-label">Your ID:</span>
          <span className="id-chip" title={peerId}>
            {peerId || 'Generating...'}
          </span>
          <button
            className="btn-ghost"
            onClick={copyShareLink}
            disabled={!peerId}
            title="Copy invite URL"
          >
            {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
            <span>{copied ? 'Copied Link' : 'Copy Link'}</span>
          </button>
        </div>

        {/* Center: Quick Hint */}
        <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b' }}>
          Open in 2 tabs to test instantly
        </div>

        {/* Right: Dial Input & Call Button */}
        <div className="dialer-box">
          <input
            type="text"
            className="dial-input"
            placeholder="Paste peer ID to call..."
            value={remotePeerIdValue}
            onChange={(e) => setRemotePeerIdValue(e.target.value)}
            disabled={callStatus === 'Connected' || callStatus === 'Calling'}
          />
          {callStatus === 'Connected' || callStatus === 'Calling' ? (
            <button
              className="btn-primary"
              style={{ background: '#ef4444' }}
              onClick={endCall}
            >
              <PhoneOff size={15} /> End
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={() => callPeer(remotePeerIdValue)}
              disabled={!remotePeerIdValue || !peerId}
            >
              <Phone size={15} /> Call
            </button>
          )}
        </div>
      </div>

      {/* Video Stage Area */}
      <div className="video-stage" ref={stageContainerRef}>
        {callStatus === 'Idle' ? (
          /* Idle / Lobby Preview: Full local preview */
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div className="lobby-preview-tips">
              Camera & Mic preview active. Share your link or enter a peer ID above.
            </div>
            {renderLocalVideo(false)}
          </div>
        ) : layoutMode === 'grid' ? (
          /* Grid Mode: Side-by-side equal split */
          <div className="layout-grid">
            {renderLocalVideo(false)}
            {renderRemoteVideo(false)}
          </div>
        ) : (
          /* Spotlight / Picture-in-Picture Mode */
          <div className="layout-pip">
            <div className="remote-video-container">
              {isSwapped ? renderLocalVideo(false) : renderRemoteVideo(false)}
            </div>
            <div className="local-video-container">
              {isSwapped ? renderRemoteVideo(true) : renderLocalVideo(true)}
            </div>
          </div>
        )}

        {/* In-Call Floating Control Dock */}
        <div className="floating-dock">
          {/* Mic */}
          <button
            className={`btn-icon ${isAudioMuted ? 'danger' : ''}`}
            onClick={toggleAudio}
            title={isAudioMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          >
            {isAudioMuted ? <MicOff size={19} /> : <Mic size={19} />}
          </button>

          {/* Camera */}
          <button
            className={`btn-icon ${isVideoMuted ? 'danger' : ''}`}
            onClick={toggleVideo}
            title={isVideoMuted ? 'Start Camera' : 'Stop Camera'}
          >
            {isVideoMuted ? <VideoOff size={19} /> : <VideoIcon size={19} />}
          </button>

          {/* Screen Share */}
          <button
            className={`btn-icon ${isScreenSharing ? 'active' : ''}`}
            onClick={toggleScreenShare}
            title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
          >
            {isScreenSharing ? <MonitorOff size={19} /> : <Monitor size={19} />}
          </button>

          {/* Layout Switcher (Grid vs PiP) */}
          {callStatus !== 'Idle' && (
            <button
              className={`btn-icon ${layoutMode === 'grid' ? 'active' : ''}`}
              onClick={() => setLayoutMode(layoutMode === 'pip' ? 'grid' : 'pip')}
              title={layoutMode === 'pip' ? 'Switch to Grid View' : 'Switch to Spotlight View'}
            >
              <LayoutGrid size={19} />
            </button>
          )}

          {/* Fullscreen */}
          <button
            className="btn-icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>

          {/* End Call / Leave button */}
          {(callStatus === 'Connected' || callStatus === 'Calling') && (
            <button className="btn-icon end-call" onClick={endCall}>
              <PhoneOff size={18} />
              <span>Leave</span>
            </button>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
