"use client";

import Image from "next/image";
import { useState } from "react";

/** 显示平台头像，缺失或加载失败时改用对应渠道的默认图。 */
export function UserAvatar({
  src,
  provider,
}: {
  src: string | null;
  provider: "wechat" | "alipay";
}) {
  const [failed, setFailed] = useState(false);

  return (
    <Image
      src={!failed && src ? src : `/avatars/${provider}.svg`}
      alt="用户头像"
      width={48}
      height={48}
      unoptimized
      onError={() => setFailed(true)}
    />
  );
}
