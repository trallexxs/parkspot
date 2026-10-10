import { Route, Routes, useLocation } from "react-router-dom";
import BottomNav from "./components/BottomNav.jsx";
import Home from "./pages/Home.jsx";
import Lot from "./pages/Lot.jsx";
import Booking from "./pages/Booking.jsx";
import Tickets from "./pages/Tickets.jsx";
import Enter from "./pages/Enter.jsx";
import Display from "./pages/Display.jsx";
import Vision from "./pages/Vision.jsx";
import Camera from "./pages/Camera.jsx";
import Operator from "./pages/Operator.jsx";

export default function App() {
  const { pathname } = useLocation();
  const fullscreen = pathname.startsWith("/display");
  return (
    <div className={fullscreen ? "app full" : "app"}>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lot/:id" element={<Lot />} />
          <Route path="/booking/:bid" element={<Booking />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/enter/:id" element={<Enter />} />
          <Route path="/session/:sid" element={<Enter />} />
          <Route path="/display/:id" element={<Display />} />
          <Route path="/vision" element={<Vision />} />
          <Route path="/camera" element={<Camera />} />
          <Route path="/camera/:id" element={<Camera />} />
          <Route path="/operator/:id" element={<Operator />} />
        </Routes>
      </main>
      {!fullscreen && <BottomNav />}
    </div>
  );
}
