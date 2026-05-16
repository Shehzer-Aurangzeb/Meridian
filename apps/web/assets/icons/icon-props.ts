import { ComponentProps } from 'react';

export type IconProps = ComponentProps<'svg'>;

export const defaultIconProps: IconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  className: 'w-[17px] h-[17px] shrink-0',
};
