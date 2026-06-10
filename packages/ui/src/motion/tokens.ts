export const motionTokens = {
  spring: {
    type: "spring",
    stiffness: 340,
    damping: 32,
    mass: 0.8,
  },
  fade: {
    duration: 0.18,
    ease: "easeOut",
  },
} as const;
