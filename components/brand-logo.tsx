import Image from "next/image";

type BrandLogoProps = {
  className?: string;
  priority?: boolean;
};

export function BrandLogo({ className, priority = false }: BrandLogoProps) {
  return (
    <Image
      src="/dayong-logo.png"
      alt="D' San Roque Dayong Providers Inc."
      width={2000}
      height={2000}
      className={className}
      priority={priority}
    />
  );
}
