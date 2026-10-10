import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function QR({ value, size = 180 }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(value, { width: size, margin: 1 }).then(setSrc).catch(() => setSrc(""));
  }, [value, size]);
  return src ? <img src={src} width={size} height={size} alt="QR code" className="qr" /> : null;
}
