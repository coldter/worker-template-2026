import { ChevronLeft } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/modules/ui/avatar";

import { SignInForm } from "./sign-in-form";

interface SignInPasswordStepProps {
  onBack: () => void;
  onSuccess: () => void;
  onTwoFactorRequired: (email: string) => void;
  user: {
    name: string | null;
    email: string;
    image: string | null;
  };
}

export const SignInPasswordStep = ({
  user,
  onBack,
  onSuccess,
  onTwoFactorRequired,
}: SignInPasswordStepProps) => {
  const displayName = user.name || "User";

  const initials = user.name
    ? user.name
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : (user.email[0] || "U").toUpperCase();

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <button
          aria-label="Back"
          className="group bg-background hover:bg-accent flex size-10 items-center justify-center rounded-full border transition-colors"
          onClick={onBack}
          type="button"
        >
          <ChevronLeft className="text-muted-foreground group-hover:text-foreground size-6" />
        </button>
        <div className="flex items-center space-x-3">
          <Avatar className="size-10">
            <AvatarImage alt={displayName} src={user.image ?? undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm leading-none font-semibold">
              {displayName}
            </span>
            <span className="text-muted-foreground text-xs">{user.email}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="text-foreground text-2xl font-bold">Enter password</h1>
        <p className="text-muted-foreground text-sm">
          Please enter your password to continue.
        </p>
      </div>

      <SignInForm
        initialEmail={user.email}
        onSuccess={onSuccess}
        onTwoFactorRequired={onTwoFactorRequired}
        showEmailField={false}
      />
    </div>
  );
};
