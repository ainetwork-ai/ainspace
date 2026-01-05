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

// UUID v4 format validation
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Ethereum address validation (0x + 40 hex characters)
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidUUID(value: string): boolean {
    return UUID_V4_REGEX.test(value);
}

export function isValidEthAddress(value: string): boolean {
    return ETH_ADDRESS_REGEX.test(value);
}
