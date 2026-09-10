import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Separator } from "@/modules/ui/separator";
import { SidebarTrigger } from "@/modules/ui/sidebar";

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean;
  ref?: React.Ref<HTMLElement>;
};

export function Header({ className, fixed, children, ...props }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const offset =
        document.body.scrollTop || document.documentElement.scrollTop;
      setIsScrolled(offset > 10);
    };

    document.addEventListener("scroll", onScroll, { passive: true });

    return () => document.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "z-50 h-16",
        fixed && "header-fixed peer/header sticky top-0 w-[inherit]",
        isScrolled && fixed ? "shadow" : "shadow-none",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "relative flex h-full items-center gap-3 p-4 sm:gap-4",
          isScrolled &&
            fixed &&
            "after:bg-background/20 after:absolute after:inset-0 after:-z-10 after:backdrop-blur-lg"
        )}
      >
        <SidebarTrigger className="max-md:scale-125" variant="outline" />
        <Separator className="h-6" orientation="vertical" />
        {children}
      </div>
    </header>
  );
}
