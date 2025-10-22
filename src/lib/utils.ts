import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { v4 as uuidv4 } from 'uuid';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function createSession() {
    return uuidv4();
}

export function shortAddress(address: string, startIndex = 3) {
    if (address.length > 10) {
        const result = address.substring(0, startIndex) + '...' + address.substring(address.length - 4, address.length);
        return result;
    }
    return address;
}
