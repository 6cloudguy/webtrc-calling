# WebRTC Video Calling App

A fast, serverless WebRTC video calling web application ready to be hosted on Vercel.

## Features
- **Direct WebRTC P2P Video & Audio Calling**: Low-latency video and audio stream exchange.
- **One-Click Shareable Link**: Click "Copy Invite Link" and send it to another user or open in a second browser tab.
- **Call Controls**: Mute/unmute microphone, enable/disable camera, answer/decline incoming calls, end call.
- **Zero Server Setup**: Uses client-side PeerJS with public STUN servers (`stun.l.google.com:19302`).

---

## Deploying to Vercel

### Option 1: Vercel CLI
```bash
npx vercel
```

### Option 2: GitHub / GitLab / Bitbucket
1. Push this repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial WebRTC app"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. Import the repository in [Vercel Dashboard](https://vercel.com/new).
3. Framework preset will automatically be detected as **Vite**.
4. Click **Deploy**.

---

## Local Development
```bash
# Install dependencies
npm install

# Start local dev server
npm run dev
```
Open `http://localhost:5173` in two different browser tabs/windows to test calling between them!

---

## Architecture & Considerations with Vercel

1. **Signaling on Serverless**:
   - Vercel functions are stateless and serverless, so traditional persistent WebSocket servers (e.g., `socket.io` in a stateful Node server) cannot run directly on Vercel without external brokers.
   - **How this app solves it**: It uses PeerJS which utilizes cloud signaling to exchange SDP offers and ICE candidates. The webapp itself is 100% static client-side code that deploys without serverless timeouts or connection drop issues.

2. **HTTPS / Permissions**:
   - Modern browsers require HTTPS (or `localhost`) to access camera/mic (`navigator.mediaDevices.getUserMedia`).
   - Vercel automatically provisions SSL/TLS certificates, ensuring camera and microphone permissions work seamlessly.

3. **NAT & Firewalls (STUN/TURN)**:
   - This app includes Google's public STUN servers for NAT traversal.
   - For symmetric corporate NATs or strict firewalls where direct P2P is blocked, you can add TURN server credentials (e.g. from Metered, Twilio, or Xirsys) in `src/App.jsx`.
