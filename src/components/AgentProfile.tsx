'use client';

import Image from 'next/image';
import { TILE_SIZE } from '@/constants/game'; 
import { User } from 'lucide-react';

interface AgentProfileProps {
    width: number;
    height: number;
    imageUrl?: string;
    backgroundColor?: string;
}

export const AgentProfile = ({ width, height, imageUrl, backgroundColor = '#FFFFFF' }: AgentProfileProps) => {
  const displayWidth = width > TILE_SIZE ? TILE_SIZE : width;
  const imageXStartPosition = (TILE_SIZE - displayWidth) / 2 * -1;

  return (
      <div 
          style={{ width, height, backgroundColor: backgroundColor }}
          className='flex items-center justify-center overflow-hidden relative rounded-sm'
      >
        <div className='w-full h-full items-center justify-start'>
            {
                imageUrl ?
                    <div className='relative h-full overflow-hidden m-auto flex items-center justify-center' style={{ width: TILE_SIZE }}>
                        <Image
                            src={imageUrl}
                            alt='Profile'
                            className='absolute object-none'
                            fill
                            unoptimized
                            style={{ 
                                objectPosition: `${imageXStartPosition}px center`, 
                                top: 0, 
                                left: 0
                            }}
                        />
                    </div> :
                    <User 
                        className='m-auto w-[80%] h-full text-[#CAD0D7] fill-[#CAD0D7]'
                        strokeWidth={0.7}
                        width={width}
                        height={height}
                    />
            } 
        </div>
      </div>
  )
}