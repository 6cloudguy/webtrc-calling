import React, { useEffect, useRef } from 'react';
import { Mic, MicOff, Monitor, Maximize2 } from 'lucide-react';
import { useAudioActivity } from '../hooks/useAudioActivity';

export default function VideoTile({
  stream,
  label = 'Participant',
  isLocal = false,
  isAudioMuted = false,
  isVideoMuted = false,
  isScreenSharing = false,
  isPip = false,
  onClick,
  onDoubleClick,
  peerStatus = '', // e.g. 'Calling...' or 'Connected'
  videoRef: externalVideoRef,
}) {
  const internalVideoRef = useRef(null);
  const videoRef = externalVideoRef || internalVideoRef;
  const isSpeaking = useAudioActivity(stream, isAudioMuted);

  // Reliably bind stream to video element
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (stream) {
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }
      videoEl.muted = isLocal;
      videoEl.playsInline = true;
      videoEl.setAttribute('playsinline', 'true');
      videoEl.setAttribute('webkit-playsinline', 'true');

      if (!isLocal) {
        videoEl.autoPictureInPicture = true;
        videoEl.setAttribute('autopictureinpicture', 'true');
      }

      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          // Normal if user hasn't interacted with page yet on some mobile devices
          console.log('Video autoplay deferred:', err.name);
        });
      }
    } else {
      videoEl.srcObject = null;
    }
  }, [stream, isLocal, videoRef]);

  // Determine avatar initials
  const initials = isLocal
    ? 'YOU'
    : label.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'P2P';

  const hasVideoTrack =
    stream &&
    stream.getVideoTracks().length > 0 &&
    stream.getVideoTracks()[0].enabled &&
    !isVideoMuted;

  return (
    <div
      className={`video-tile ${isPip ? 'is-pip' : ''} ${isSpeaking ? 'is-speaking' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={isPip ? 'Tap to swap to main screen' : ''}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        autoPictureInPicture={!isLocal}
        className={`video-surface ${isLocal && !isScreenSharing ? 'mirrored' : ''}`}
        style={{ display: hasVideoTrack ? 'block' : 'none' }}
      />

      {/* Fallback Avatar when camera is off or stream waiting */}
      {!hasVideoTrack && (
        <div className="avatar-fallback">
          <div className={`avatar-disc ${isSpeaking ? 'avatar-speaking' : ''}`}>
            {initials}
          </div>
          <span className="avatar-label">
            {peerStatus || (isVideoMuted ? 'Camera Off' : 'Connecting stream...')}
          </span>
        </div>
      )}

      {/* Floating Status Badge (Bottom-Left) */}
      <div className="tile-badge-bottom">
        <span className={`tile-mic-indicator ${isAudioMuted ? 'muted' : ''} ${isSpeaking ? 'speaking' : ''}`}>
          {isAudioMuted ? <MicOff size={13} /> : <Mic size={13} />}
        </span>

        {isScreenSharing && (
          <span className="tile-tag-screen" title="Screen sharing active">
            <Monitor size={12} />
          </span>
        )}

        <span className="tile-name-tag">{label}</span>
      </div>

      {/* Speaking Indicator Border Glow */}
      {isSpeaking && <div className="speaking-glow-border" />}
    </div>
  );
}
