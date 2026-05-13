import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import { TauriInitialization } from "@/shared/components/TauriInitialization";

export const metadata = {
  title: "Zippy Mesh",
  description: "Standalone AI Routing & P2P Mesh",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <TauriInitialization />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
