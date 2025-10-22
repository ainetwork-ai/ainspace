import Image from 'next/image';

export default function LoginPage() {
    return (
        <div className="flex h-screen w-full max-w-800 flex-col items-center justify-center gap-6 bg-[#B1E1FF]">
            <Image src="/login/logo.svg" alt="Login Background" width={190} height={108} />
            <button className="z-10 inline-flex h-14 w-[190px] cursor-pointer items-center justify-center gap-2.5 rounded bg-[#7f4fe8] px-[18px] py-2">
                <div data-layer="Import" className="Import justify-start font-['SF_Pro'] text-xl font-bold text-white">
                    Wallet Login
                </div>
            </button>
            <Image src="/login/ainetwork.svg" alt="ainetwork" className="z-10" width={133} height={22} />
            <div className="h-10" />
            <div className="fixed bottom-0 flex w-full justify-center">
                <Image src="/login/login_background.png" alt="Login Background" width={600} height={1000} />
            </div>
        </div>
    );
}
