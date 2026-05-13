import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "",
      primary: "primary",
      outline: "btn-outline",
    },
    size: {
      default: "",
      sm: "btn-sm",
      lg: "btn-lg",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className = "", variant, size, ...props }: ButtonProps) {
  return <button className={twMerge(buttonVariants({ variant, size }), className)} {...props} />;
}
