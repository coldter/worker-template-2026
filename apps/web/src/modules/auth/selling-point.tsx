import { motion, useReducedMotion } from "framer-motion";

interface SellingPointProps {
  bgGradient?: string;
  bgImage?: string;
  description: string;
  title: string;
}

export const SellingPoint = ({
  title,
  description,
  bgImage,
  bgGradient = "from-indigo-600 via-purple-600 to-pink-500",
}: SellingPointProps) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="relative flex h-full flex-col justify-center p-8 select-none">
      {bgImage ? (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          height={600}
          src={bgImage}
          width={800}
        />
      ) : (
        <div
          aria-hidden="true"
          className={`absolute inset-0 bg-linear-to-br ${bgGradient}`}
        />
      )}
      <div className="relative z-10 flex flex-col items-center justify-center">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.6 }}
        >
          <h2 className="mb-2 text-center text-5xl font-bold text-white drop-shadow-2xl">
            {title}
          </h2>
        </motion.div>
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
          transition={
            shouldReduceMotion ? { duration: 0 } : { delay: 0.1, duration: 0.6 }
          }
        >
          <p className="text-center text-lg leading-relaxed text-white/80">
            {description}
          </p>
        </motion.div>
      </div>
    </div>
  );
};
