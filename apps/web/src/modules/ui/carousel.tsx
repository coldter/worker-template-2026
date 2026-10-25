import createAutoplayPlugin from "embla-carousel-autoplay";
import type { UseEmblaCarouselType } from "embla-carousel-react";
import useEmblaCarousel from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";

type CarouselApi = UseEmblaCarouselType[1];

type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;

type CarouselOptions = UseCarouselParameters[0];

type CarouselPlugin = UseCarouselParameters[1];

interface CarouselProps {
  autoplay?: boolean;
  autoplayDelay?: number;
  opts?: CarouselOptions;
  orientation?: "horizontal" | "vertical";
  plugins?: CarouselPlugin;
  setApi?: (api: CarouselApi) => void;
}

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  api: ReturnType<typeof useEmblaCarousel>[1];
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
} & CarouselProps;

const CarouselContext = createContext<CarouselContextProps | null>(null);

const useCarousel = () => {
  const context = useContext(CarouselContext);

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />");
  }

  return context;
};

const Carousel = ({
  orientation = "horizontal",
  opts,
  setApi,
  plugins,
  className,
  children,
  autoplay = true,
  autoplayDelay = 4000,
  ...props
}: HTMLAttributes<HTMLDivElement> & CarouselProps) => {
  const effectivePlugins = autoplay
    ? [createAutoplayPlugin({ delay: autoplayDelay }), ...(plugins ?? [])]
    : plugins;

  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === "horizontal" ? "x" : "y",
    },
    effectivePlugins
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      api?.on("reInit", onStoreChange);
      api?.on("select", onStoreChange);

      return () => {
        api?.off("reInit", onStoreChange);
        api?.off("select", onStoreChange);
      };
    },
    [api]
  );

  const getCanScrollPrev = useCallback(
    () => api?.canScrollPrev() ?? false,
    [api]
  );

  const getCanScrollNext = useCallback(
    () => api?.canScrollNext() ?? false,
    [api]
  );

  const canScrollPrev = useSyncExternalStore(
    subscribe,
    getCanScrollPrev,
    getCanScrollPrev
  );

  const canScrollNext = useSyncExternalStore(
    subscribe,
    getCanScrollNext,
    getCanScrollNext
  );

  const scrollPrev = useCallback(() => {
    api?.scrollPrev();
  }, [api]);

  const scrollNext = useCallback(() => {
    api?.scrollNext();
  }, [api]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext]
  );

  useEffect(() => {
    if (api && setApi) {
      setApi(api);
    }
  }, [api, setApi]);

  const contextValue = useMemo<CarouselContextProps>(
    () => ({
      api,
      autoplay,
      autoplayDelay,
      canScrollNext,
      canScrollPrev,
      carouselRef,
      opts,
      orientation:
        orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
      scrollNext,
      scrollPrev,
    }),
    [
      api,
      autoplay,
      autoplayDelay,
      canScrollNext,
      canScrollPrev,
      carouselRef,
      opts,
      orientation,
      scrollNext,
      scrollPrev,
    ]
  );

  return (
    <CarouselContext.Provider value={contextValue}>
      <section
        aria-label="Image carousel"
        className={cn("relative", className)}
        onKeyDownCapture={handleKeyDown}
        {...props}
      >
        {children}
      </section>
    </CarouselContext.Provider>
  );
};

const CarouselContent = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => {
  const { carouselRef, orientation } = useCarousel();

  return (
    <div className="overflow-hidden" ref={carouselRef}>
      <div
        className={cn(
          "flex",
          orientation === "horizontal" ? "" : "flex-col",
          className
        )}
        {...props}
      />
    </div>
  );
};

const CarouselItem = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => {
  const { orientation } = useCarousel();

  return (
    <article
      className={cn(
        "min-w-0 shrink-0 grow-0 basis-full",
        orientation === "horizontal" ? "pl-4" : "pt-4",
        className
      )}
      {...props}
    />
  );
};

const CarouselPrevious = ({
  className,
  variant = "outline",
  size = "icon",
  ...props
}: ComponentProps<typeof Button>) => {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel();

  return (
    <Button
      className={cn(
        "absolute h-10 w-10 rounded-full transition-all duration-200",
        orientation === "horizontal"
          ? "top-1/2 left-6 -translate-y-1/2"
          : "-top-12 left-1/2 -translate-x-1/2 rotate-90",
        className
      )}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      size={size}
      variant={variant}
      {...props}
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="sr-only">Previous slide</span>
    </Button>
  );
};

const CarouselNext = ({
  className,
  variant = "outline",
  size = "icon",
  ...props
}: ComponentProps<typeof Button>) => {
  const { orientation, scrollNext, canScrollNext } = useCarousel();

  return (
    <Button
      className={cn(
        "absolute h-10 w-10 rounded-full transition-all duration-200",
        orientation === "horizontal"
          ? "top-1/2 right-6 -translate-y-1/2"
          : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90",
        className
      )}
      disabled={!canScrollNext}
      onClick={scrollNext}
      size={size}
      variant={variant}
      {...props}
    >
      <ArrowRight className="h-4 w-4" />
      <span className="sr-only">Next slide</span>
    </Button>
  );
};

export {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
};
