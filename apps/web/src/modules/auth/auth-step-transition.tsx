import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

interface AuthStepTransitionProps {
  children: ReactNode;
  step: string;
}

export function AuthStepTransition({
  children,
  step,
}: AuthStepTransitionProps) {
  const shouldReduceMotion = useReducedMotion();

  const variants = {
    animate: {
      opacity: 1,
      x: 0,
    },
    exit: {
      opacity: 0,
      x: shouldReduceMotion ? 0 : -50,
    },
    initial: {
      opacity: 0,
      x: shouldReduceMotion ? 0 : 50,
    },
  };

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate="animate"
        className="w-full"
        exit="exit"
        initial="initial"
        key={step}
        transition={{
          damping: 30,
          stiffness: 300,
          type: "spring",
        }}
        variants={variants}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
