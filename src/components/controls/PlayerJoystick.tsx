"use client";

import { Joystick } from "react-joystick-component";
import { useRef } from "react";
import { IJoystickUpdateEvent } from "react-joystick-component/build/lib/Joystick";

interface PlayerJoystickProps {
  onMove: (direction: "up" | "down" | "left" | "right") => void;
  disabled?: boolean;
  size?: number;
  baseColor?: string;
  stickColor?: string;
}

export default function PlayerJoystick({
  onMove,
  disabled = false,
  size = 100,
  baseColor,
  stickColor,
}: PlayerJoystickProps) {
  const lastDirectionRef = useRef<"up" | "down" | "left" | "right" | null>(null);
  const moveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleMove = (event: IJoystickUpdateEvent) => {
    if (disabled || !event.direction) return;

    // Map IJoystickUpdateEvent direction to our direction type
    let direction: "up" | "down" | "left" | "right" | null = null;

    switch (event.direction) {
      case "FORWARD":
        direction = "up";
        break;
      case "BACKWARD":
        direction = "down";
        break;
      case "LEFT":
        direction = "left";
        break;
      case "RIGHT":
        direction = "right";
        break;
    }

    if (!direction) return;

    // If direction changed or first move, update and move immediately
    if (lastDirectionRef.current !== direction) {
      lastDirectionRef.current = direction;

      // Clear any existing interval
      if (moveIntervalRef.current) {
        clearInterval(moveIntervalRef.current);
        moveIntervalRef.current = null;
      }

      // Move immediately
      onMove(direction);

      // Start continuous movement interval (move every 200ms while holding)
      moveIntervalRef.current = setInterval(() => {
        if (lastDirectionRef.current) {
          onMove(lastDirectionRef.current);
        }
      }, 200);
    }
  };

  const handleStop = () => {
    // Clear movement interval
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
      moveIntervalRef.current = null;
    }
    lastDirectionRef.current = null;
  };

  return (
    <div className="flex items-center justify-center mb-4">
      <Joystick
        size={size}
        stickSize={50}
        baseColor={disabled ? "#D1D5DB" : baseColor}
        stickColor={disabled ? "#9CA3AF" : stickColor}
        move={handleMove}
        stop={handleStop}
        throttle={50}
        disabled={disabled}
      />
    </div>
  );
}
