import { IconProps, defaultIconProps } from './icon-props';

export function SearchIcon(props: IconProps) {
  return (
    <svg {...defaultIconProps} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
