import { cn } from "@/lib/utils";

type ButtonType = 'large' | 'small';
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'line';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: ButtonType;
  variant?: ButtonVariant;
}

export default function Button({
  children,
  onClick = () => {},
  className = '',
  disabled = false,
  type = 'large',
  variant = 'primary',
}: ButtonProps) {
    const buttonClassMap = {
      large: 'rounded-sm px-[18px] py-4 font-bold leading-[120%]',
      small: 'rounded-sm px-2 font-medium text-sm',
    }

    const variantClassMap = {
      primary:
        'bg-[#7F4FE8] hover:bg-[#642CD8] disabled:bg-[#99A1AE] dark:disabled:bg-[#5F666F] text-white',
      secondary:
        'bg-[#EAE0FF] hover:bg-[#C0A9F1] text-[#7F4FE8] disabled:bg-[#99A1AE] dark:bg-[#3A3050] dark:hover:bg-[#4A3E60] dark:text-[#C0A9F1] dark:disabled:bg-[#5F666F]',
      ghost:
        'bg-[#F3F3F3] text-gray-500 disabled:bg-[#99A1AE] dark:bg-[#3A3E46] dark:text-[#CAD0D7] dark:disabled:bg-[#5F666F]',
      line:
        'border border-[#7F4FE8] text-[#7F4FE8] bg-transparent hover:bg-[#EAE0FF] disabled:border-[#969EAA] disabled:text-[#969EAA] disabled:bg-transparent dark:border-[#C0A9F1] dark:text-[#C0A9F1] dark:hover:bg-[#7F4FE866] dark:disabled:border-[#969EAA] dark:disabled:text-[#969EAA] dark:disabled:bg-transparent',
    }

    return (
      <button
          onClick={onClick}
          disabled={disabled}
          className={
              cn(
                  'transition-colors disabled:cursor-not-allowed mx-auto w-fit text-center',
                  buttonClassMap[type],
                  variantClassMap[variant],
                  className,
              )
          }
          type="button"
      >
          {children}
      </button>
    )
}
