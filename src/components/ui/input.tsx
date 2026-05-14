import * as React from "react";
import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, value, onChange, onCompositionStart, onCompositionEnd, ...props }, ref) => {
    const isControlled = value !== undefined;
    const composingRef = React.useRef(false);
    const [displayValue, setDisplayValue] = React.useState(
      isControlled ? String(value ?? "") : ""
    );

    // Keep display value in sync with parent value (but not during IME composition)
    React.useEffect(() => {
      if (!composingRef.current && isControlled) {
        setDisplayValue(String(value ?? ""));
      }
    }, [value, isControlled]);

    return (
      <input
        ref={ref}
        {...props}
        value={isControlled ? displayValue : undefined}
        onChange={(e) => {
          if (isControlled) setDisplayValue(e.target.value);
          if (!composingRef.current) onChange?.(e);
        }}
        onCompositionStart={(e) => {
          composingRef.current = true;
          onCompositionStart?.(e);
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          onCompositionEnd?.(e);
          // React 19: 'input' event fires after 'compositionend', so onChange
          // will be called from the onChange handler above once composingRef is false.
        }}
        className={cn(
          "flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm",
          "placeholder:text-gray-400",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
