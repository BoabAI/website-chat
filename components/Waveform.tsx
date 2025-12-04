import React, { useEffect, useState } from 'react';

interface WaveformProps {
  isActive: boolean;
  barColor?: string;
}

const Waveform: React.FC<WaveformProps> = ({ isActive, barColor = "bg-secondary" }) => {
  const [bars, setBars] = useState<number[]>(new Array(5).fill(10));

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isActive) {
      interval = setInterval(() => {
        setBars(prev => prev.map(() => Math.floor(Math.random() * 20) + 8));
      }, 100);
    } else {
      setBars(new Array(5).fill(4));
    }
    return () => clearInterval(interval);
  }, [isActive]);

  return (
    <div className="flex items-center justify-center gap-1 h-8">
      {bars.map((height, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-100 ${barColor}`}
          style={{ height: `${height}px` }}
        />
      ))}
    </div>
  );
};

export default Waveform;
