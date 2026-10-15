import React, { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

export default function App() {
  const [peerId, setPeerId] = useState('');
  const [remotePeerIdValue, setRemotePeerIdValue] = useState('');
  const [callStatus, setCallStatus] = useState('Idle'); // 'Idle' | 'Calling' | 'Connected' | 'Incoming'
  const [incomingCall, setIncomingCall] = useState(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerInstance = useRef(null);
  const currentCall = useRef(null);
  const localStreamRef = useRef(null);

  // Initialize camera and PeerJS
  useEffect(() => {
    let peer = null;

    async function initMediaAndPeer() {
      try {
        // 1. Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Failed to get media devices:', err);
        setErrorMessage(
          'Camera/Microphone permission denied or unavailable. WebRTC needs camera/mic access.'
        );
      }

      // 2. Initialize PeerJS (uses PeerJS free cloud signaling & public Google STUN)
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

        // Check if there's a ?call= parameter in the URL
        const params = new URLSearchParams(window.location.search);
        const targetId = params.get('call');
        if (targetId && targetId !== id) {
          setRemotePeerIdValue(targetId);
        }
      });

      // Handle incoming calls
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

    initMediaAndPeer();

    return () => {
      if (currentCall.current) {
        currentCall.current.close();
      }
      if (peerInstance.current) {
        peerInstance.current.destroy();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
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
  };

  // Reject incoming call
  const rejectCall = () => {
    if (incomingCall) {
      incomingCall.close();
      setIncomingCall(null);
      setCallStatus('Idle');
    }
  };

  // Initiate an outgoing call
  const callPeer = (remoteId) => {
    if (!remoteId || !peerInstance.current) return;
    setCallStatus('Calling');
    setErrorMessage('');

    const call = peerInstance.current.call(remoteId, localStreamRef.current);

    if (!call) {
      setErrorMessage('Could not establish call to peer.');
      setCallStatus('Idle');
      return;
    }

    call.on('stream', (remoteStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      setCallStatus('Connected');
    });

    call.on('close', () => {
      endCall();
    });

    call.on('error', (err) => {
      console.error('Call error:', err);
      setErrorMessage(`Call failed: ${err.message || 'unknown error'}`);
      endCall();
    });

    currentCall.current = call;
  };

  // End active call
  const endCall = () => {
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

  // Toggle Mute Audio
  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const enabled = !audioTracks[0].enabled;
        audioTracks.forEach((t) => (t.enabled = enabled));
        setIsAudioMuted(!enabled);
      }
    }
  };

  // Toggle Video / Camera
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        const enabled = !videoTracks[0].enabled;
        videoTracks.forEach((t) => (t.enabled = enabled));
        setIsVideoMuted(!enabled);
      }
    }
  };

  // Copy shareable link
  const copyShareLink = () => {
    if (!peerId) return;
    const url = `${window.location.origin}${window.location.pathname}?call=${peerId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container">
      <header>
        <div>
          <h1>WebRTC Video Call</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            Direct Peer-to-Peer encrypted video calling
          </p>
        </div>
        <div>
          <span
            className={`badge ${
              callStatus === 'Connected'
                ? 'online'
                : callStatus === 'Calling' || callStatus === 'Incoming'
                ? 'calling'
                : ''
            }`}
          >
            ● {callStatus}
          </span>
        </div>
      </header>

      {errorMessage && (
        <div className="alert alert-danger">{errorMessage}</div>
      )}

      {/* Incoming Call Notification Banner */}
      {incomingCall && (
        <div className="panel" style={{ border: '2px solid #3b82f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Incoming call from <strong>{incomingCall.peer}</strong></span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-success" onClick={answerCall}>
                Answer
              </button>
              <button className="btn btn-danger" onClick={rejectCall}>
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection & Share Panel */}
      <div className="panel">
        <div className="info-row">
          <span>Your ID:</span>
          <code
            style={{
              backgroundColor: '#0f172a',
              padding: '0.35rem 0.6rem',
              borderRadius: '0.375rem',
              letterSpacing: '0.5px',
            }}
          >
            {peerId || 'Generating ID...'}
          </code>
          <button
            className="btn btn-secondary"
            onClick={copyShareLink}
            disabled={!peerId}
          >
            {copied ? 'Copied Link!' : 'Copy Invite Link'}
          </button>
        </div>

        <div className="info-row">
          <input
            type="text"
            className="input-box"
            placeholder="Enter remote peer ID or use invite link"
            value={remotePeerIdValue}
            onChange={(e) => setRemotePeerIdValue(e.target.value)}
            disabled={callStatus === 'Connected' || callStatus === 'Calling'}
          />
          {callStatus === 'Connected' || callStatus === 'Calling' ? (
            <button className="btn btn-danger" onClick={endCall}>
              End Call
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => callPeer(remotePeerIdValue)}
              disabled={!remotePeerIdValue || !peerId}
            >
              Call Peer
            </button>
          )}
        </div>
      </div>

      {/* Video Streams */}
      <div className="video-grid">
        {/* Local Video */}
        <div className="video-card">
          <video ref={localVideoRef} autoPlay playsInline muted />
          <span className="video-label">
            You ({peerId ? peerId.substring(0, 6) + '...' : 'Local'})
          </span>
        </div>

        {/* Remote Video */}
        <div className="video-card">
          <video ref={remoteVideoRef} autoPlay playsInline />
          <span className="video-label">
            {callStatus === 'Connected'
              ? 'Remote Peer'
              : callStatus === 'Calling'
              ? 'Calling...'
              : 'Waiting for peer connection...'}
          </span>
        </div>
      </div>

      {/* Call Controls */}
      <div className="controls">
        <button
          className={`btn ${isAudioMuted ? 'btn-danger' : 'btn-secondary'}`}
          onClick={toggleAudio}
        >
          {isAudioMuted ? 'Unmute Mic' : 'Mute Mic'}
        </button>

        <button
          className={`btn ${isVideoMuted ? 'btn-danger' : 'btn-secondary'}`}
          onClick={toggleVideo}
        >
          {isVideoMuted ? 'Start Video' : 'Stop Video'}
        </button>

        {callStatus === 'Connected' && (
          <button className="btn btn-danger" onClick={endCall}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
