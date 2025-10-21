import React from 'react';

interface BaseTabContentProps {
  isActive: boolean;
  children: React.ReactNode;
  className?: string;
  withPadding?: boolean;
}

export default function BaseTabContent({ 
  isActive, 
  children, 
  className = '', 
  withPadding = true 
}: BaseTabContentProps) {
  const paddingClass = withPadding ? 'p-4' : '';
  
  return (
    <div className={`h-full w-full ${paddingClass} flex flex-col ${!isActive ? 'hidden' : ''} ${className}`}>
      {children}
    </div>
  );
}