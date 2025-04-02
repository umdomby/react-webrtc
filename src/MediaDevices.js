import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream] = useState(new MediaStream());
    const [pc, setPc] = useState(null);
    const [ws, setWs] = useState(null);
    const [status, setStatus] = useState('Disconnected');
    const [isCallStarted, setIsCallStarted] = useState(false);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const wsRef = useRef(null); // Используем useRef для WebSocket

    // Инициализация медиаустройств
    useEffect(() => {
        const initMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });

                setLocalStream(stream);
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error('Failed to get media:', err);
            }
        };

        initMedia();

        return () => {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    // Инициализация WebSocket
    useEffect(() => {
        const websocket = new WebSocket('ws://localhost:8080/ws');
        wsRef.current = websocket;

        websocket.onopen = () => {
            setWs(websocket);
            setStatus('Connected');
            console.log('WebSocket connected');
        };

        websocket.onclose = () => {
            setStatus('Disconnected');
            console.log('WebSocket disconnected');
        };

        websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    // Обработчик сообщений WebSocket
    useEffect(() => {
        if (!wsRef.current) return;

        const handleMessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received message:', data);

                if (!pc) return;

                if (data.type === 'answer') {
                    await pc.setRemoteDescription(new RTCSessionDescription({
                        type: 'answer',
                        sdp: data.sdp
                    }));
                }
                else if (data.type === 'ice') {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (e) {
                        console.error('Error adding ICE candidate:', e);
                    }
                }
            } catch (err) {
                console.error('Error handling message:', err);
            }
        };

        wsRef.current.onmessage = handleMessage;

        return () => {
            if (wsRef.current) {
                wsRef.current.onmessage = null;
            }
        };
    }, [pc]);

    const createPeerConnection = () => {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        };

        const peerConnection = new RTCPeerConnection(config);

        // Добавляем локальные треки
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        // Обработка удаленных треков
        peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
            }
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'ice',
                    candidate: event.candidate
                }));
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            setStatus(`ICE state: ${peerConnection.iceConnectionState}`);
        };

        return peerConnection;
    };

    const startCall = async () => {
        if (isCallStarted || !wsRef.current) return;

        try {
            const peerConnection = createPeerConnection();
            setPc(peerConnection);
            setIsCallStarted(true);

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            if (wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    type: 'offer',
                    sdp: offer.sdp
                }));
            } else {
                console.error('WebSocket is not open');
            }
        } catch (err) {
            console.error('Error starting call:', err);
            setIsCallStarted(false);
        }
    };

    const endCall = () => {
        if (pc) {
            pc.close();
            setPc(null);
        }
        setIsCallStarted(false);
        setStatus('Disconnected');

        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
        }
    };

    return (
        <div className="App">
            <h1>WebRTC Video Chat</h1>
            <div className="video-container">
                <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="local-video"
                />
                <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="remote-video"
                />
            </div>
            <div className="controls">
                <button onClick={startCall} disabled={isCallStarted || !ws}>
                    Start Call
                </button>
                <button onClick={endCall} disabled={!isCallStarted}>
                    End Call
                </button>
                <p>Status: {status}</p>
            </div>
        </div>
    );
}

export default App;