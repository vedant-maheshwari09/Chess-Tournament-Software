import React, { useState, useEffect } from "react";

interface TournamentCountdownProps {
  targetDate: string | Date;
}

export default function TournamentCountdown({ targetDate }: TournamentCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  } | null>(null);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const difference = +new Date(targetDate) - +new Date();
      
      if (difference > 0) {
        setTimeLeft({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((difference / 1000 / 60) % 60),
          seconds: Math.floor((difference / 1000) % 60),
        });
      } else {
        setTimeLeft(null);
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [targetDate]);

  if (!timeLeft) {
    return <div className="text-xl font-bold">Event has started!</div>;
  }

  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      <div className="bg-white/10 rounded-lg p-2">
        <div className="text-2xl font-bold">{timeLeft.days}</div>
        <div className="text-[10px] uppercase opacity-70">Days</div>
      </div>
      <div className="bg-white/10 rounded-lg p-2">
        <div className="text-2xl font-bold">{timeLeft.hours}</div>
        <div className="text-[10px] uppercase opacity-70">Hrs</div>
      </div>
      <div className="bg-white/10 rounded-lg p-2">
        <div className="text-2xl font-bold">{timeLeft.minutes}</div>
        <div className="text-[10px] uppercase opacity-70">Min</div>
      </div>
      <div className="bg-white/10 rounded-lg p-2">
        <div className="text-2xl font-bold">{timeLeft.seconds}</div>
        <div className="text-[10px] uppercase opacity-70">Sec</div>
      </div>
    </div>
  );
}
