"use client";

import { useState, useEffect } from "react";

const KEY = "kmd_guest_count";
const MAX = 3;

export function useGuestLimit(isLoggedIn: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isLoggedIn) {
      setCount(parseInt(localStorage.getItem(KEY) || "0", 10));
    } else {
      setCount(0);
    }
  }, [isLoggedIn]);

  function consume(): boolean {
    if (isLoggedIn) return true;
    const current = parseInt(localStorage.getItem(KEY) || "0", 10);
    if (current >= MAX) return false;
    const next = current + 1;
    localStorage.setItem(KEY, String(next));
    setCount(next);
    return true;
  }

  return {
    count,
    max: MAX,
    remaining: isLoggedIn ? Infinity : MAX - count,
    isBlocked: !isLoggedIn && count >= MAX,
    consume,
  };
}
