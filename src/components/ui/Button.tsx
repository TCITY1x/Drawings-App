import { cn } from "@/lib/cn";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  // "button" unless said otherwise: a plain <button> in a form submits it.
  return (
    <button
      type={type}
      className={cn(
        "rounded-lg border border-transparent font-medium transition-colors duration-200",
        size === "sm" && "px-3 py-1.5 text-sm",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        variant === "primary" &&
          "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:disabled:bg-indigo-500/40",
        variant === "secondary" &&
          "border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:disabled:text-slate-500",
        variant === "ghost" &&
          "text-slate-700 hover:bg-slate-100 disabled:text-slate-400 dark:text-slate-300 dark:hover:bg-slate-800 dark:disabled:text-slate-600",
        variant === "danger" &&
          "bg-red-100 text-red-700 hover:bg-red-200 disabled:bg-red-50 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25 dark:disabled:bg-red-500/5",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
