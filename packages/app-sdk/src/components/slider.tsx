import React, { forwardRef } from 'react';
import { ensureUiStyles } from './ui-styles';

export type SliderProps = Omit<React.ComponentPropsWithoutRef<'input'>, 'type'>;

/** Native range semantics: arrows, Home/End, form values and constraints stay with the browser. */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider({ className, ...props }, ref) {
  return <input {...props} type="range" className={['pero-ui-slider', className].filter(Boolean).join(' ')}
    ref={node => {
      if (node) ensureUiStyles(node.ownerDocument);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }} />;
});
