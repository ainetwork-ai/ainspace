'use client';

import Image from 'next/image';
import { TILE_SIZE } from '@/constants/game'; 
import { User } from 'lucide-react';

interface AgentProfileProps {
    width: number;
    height: number;
    imageUrl?: string;
}

export const AgentProfile = ({ width, height, imageUrl }: AgentProfileProps) => {
  const imageXStartPosition = (TILE_SIZE - width) / 2 * -1;

  return (
      <div className='bg-white flex items-center justify-center overflow-hidden relative rounded-sm' style={{ width, height }}>
        <div className='w-full h-full'>
            {
                imageUrl ?
                    <Image
                        src={imageUrl}
                        alt='Profile'
                        className='absolute object-none'
                        fill
                        unoptimized
                        style={{ objectPosition: `${imageXStartPosition}px 0`, top: 0, left: 0}}
                    /> :
                    <User className="m-auto w-[80%] h-full text-[#CAD0D7] fill-[#CAD0D7]" strokeWidth={0.7} />
            } 
        </div>
      </div>
  )
}