"use client";

export default function Footer() {
  return (
    <footer className="border-t border-[#3a2f27] bg-[#120f0d] pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-16">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-[#f97815] to-[#e0650a] text-2xl font-black text-[#181411]">
                Z
              </div>
              <span className="text-xl font-black tracking-tighter text-white">ZIPPY<span className="text-[#f97815]">MESH</span></span>
            </div>
            <p className="text-gray-400 text-sm max-w-xs mb-6">
              Standalone AI Routing & P2P Mesh. Secure, private, and local-first AI infrastructure.
            </p>
          </div>

          {/* Product */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Product</h4>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="#features">Features</a>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="/dashboard">Dashboard</a>
          </div>

          {/* Resources */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Resources</h4>
            <a className="text-gray-400 hover:text-[#f97815] text-sm transition-colors" href="#how-it-works">How it Works</a>
          </div>

          {/* Legal */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Legal</h4>
            <p className="text-gray-400 text-sm">MIT License</p>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-[#3a2f27] pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-gray-600 text-sm">© 2026 Zippy Mesh. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
