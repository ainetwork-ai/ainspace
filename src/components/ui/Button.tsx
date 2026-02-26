import { cn } from "@/lib/utils";

type ButtonType = 'large' | 'small';
type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: ButtonType;
  variant?: ButtonVariant;
  isDarkMode?: boolean;
}
export default function Button({
  children,
  onClick = () => {},
  className = '',
  disabled = false,
  type = 'large',
  variant = 'primary',
  isDarkMode = false,
}: ButtonProps) {
    const buttonClassMap = {
      large: 'rounded-sm px-[18px] py-4 font-bold leading-[120%]',
      small: 'rounded-sm px-2 font-medium text-sm',
    }

    const variantClassMap = {
      primary: isDarkMode
        ? 'bg-[#7F4FE8] hover:bg-[#642CD8] disabled:bg-[#5F666F] text-white'
        : 'bg-[#7F4FE8] hover:bg-[#642CD8] disabled:bg-[#99A1AE] text-white',
      secondary: isDarkMode
        ? 'bg-[#3A3050] hover:bg-[#4A3E60] disabled:bg-[#5F666F] text-[#C0A9F1]'
        : 'bg-[#EAE0FF] hover:bg-[#C0A9F1] disabled:bg-[#99A1AE] text-[#7F4FE8]',
      ghost: isDarkMode
        ? 'bg-[#3A3E46] disabled:bg-[#5F666F] text-[#CAD0D7]'
        : 'bg-[#F3F3F3] disabled:bg-[#99A1AE] text-gray-500',
    }

    return (
      <button
          onClick={onClick}
          disabled={disabled}
          className={
              cn(
                  'transition-colors disabled:cursor-not-allowed mx-auto w-fit text-center',
                  isDarkMode ? 'disabled:bg-[#5F666F]' : 'disabled:bg-[#99A1AE]',
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