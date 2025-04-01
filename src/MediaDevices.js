import React, { useEffect, useRef } from 'react';

const MediaDevices = ({ mediaStream, isConnected }) => {
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);

    useEffect(() => {
        if (mediaStream && localVideoRef.current) {
            localVideoRef.current.srcObject = mediaStream;
        }

        return () => {
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = null;
            }
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = null;
            }
        };
    }, [mediaStream]);

    return (
        <div className="media-devices">
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

            <div className="device-controls">
                {!isConnected && (
                    <button
                        onClick={async () => {
                            try {
                                const stream = await navigator.mediaDevices.getUserMedia({
                                    video: true,
                                    audio: true
                                });
                                localVideoRef.current.srcObject = stream;
                            } catch (err) {
                                console.error('Error accessing media devices:', err);
                            }
                        }}
                    >
                        Test Camera/Mic
                    </button>
                )}
            </div>
        </div>
    );
};

export default MediaDevices;