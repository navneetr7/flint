import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { clsx } from "clsx";

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "neutral" | "focus" | "danger";
  }
>;

export function Button({ children, className, tone = "neutral", ...props }: ButtonProps) {
  return (
    <button className={clsx("flint-button", `flint-button-${tone}`, className)} type="button" {...props}>
      {children}
    </button>
  );
}
