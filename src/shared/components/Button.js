"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-gradient-to-b from-primary to-primary-hover text-white shadow-sm",
  secondary: "bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-text-main hover:bg-black/5 dark:hover:bg-white/5",
  outline: "border border-black/15 dark:border-white/15 text-text-main hover:bg-black/5",
  ghost: "text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main",
  danger: "bg-red-500 text-white hover:bg-red-600 shadow-sm",
};

const sizes = {
  sm: "h-7 px-3 text-xs rounded-md",
  md: "h-9 px-4 text-sm rounded-lg",
  lg: "h-11 px-6 text-sm rounded-lg",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  iconPosition = "left",
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  const showIconLeft = (icon || iconRight) && iconPosition === "left";
  const showIconRight = (iconRight || (icon && iconPosition === "right"));
  const iconName = iconPosition === "left" ? icon : (icon || iconRight);

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 cursor-pointer",
        "active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      ) : showIconLeft && icon ? (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      {children}
      {showIconRight && !loading && (
        <span className="material-symbols-outlined text-[18px]">{iconPosition === "right" ? icon : iconRight}</span>
      )}
    </button>
  );
}


