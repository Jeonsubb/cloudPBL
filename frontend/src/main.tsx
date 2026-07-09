import React from "react";
import ReactDOM from "react-dom/client";
import { AlertTriangle, Bot, FileUp, Ship } from "lucide-react";
import "./styles.css";

const sampleShipment = {
  name: "부산-LA 자동차 부품 1차",
  route: "Busan → Los Angeles",
  dueDate: "2026-08-03",
  riskScore: 78,
  riskLevel: "HIGH",
  reasons: [
    "견적 유효기간이 2일 남았지만 부킹이 완료되지 않았습니다.",
    "최근 부산발 운임지수가 상승했습니다.",
    "관련 항로에 지정학 리스크 뉴스가 감지되었습니다."
  ]
};

function App() {
  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">PortPulse MVP</p>
          <h1>내 선적 기준으로 물류 리스크를 미리 확인합니다.</h1>
          <p className="description">
            견적서와 선적 일정을 등록하면 운임, 환율, 뉴스, 납기 조건을 함께 분석해
            위험 점수와 대응 행동을 알려주는 AI 물류 리스크 서비스입니다.
          </p>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <div className="cardTitle">
            <Ship size={22} />
            <h2>선적 현황</h2>
          </div>
          <p className="muted">{sampleShipment.name}</p>
          <p className="route">{sampleShipment.route}</p>
          <p>납기일: {sampleShipment.dueDate}</p>
        </article>

        <article className="card danger">
          <div className="cardTitle">
            <AlertTriangle size={22} />
            <h2>리스크 점수</h2>
          </div>
          <strong className="score">{sampleShipment.riskScore}</strong>
          <p>{sampleShipment.riskLevel}</p>
        </article>

        <article className="card">
          <div className="cardTitle">
            <FileUp size={22} />
            <h2>문서 업로드</h2>
          </div>
          <button>견적서/엑셀 업로드</button>
          <p className="muted">S3 Presigned URL 방식으로 업로드 예정</p>
        </article>

        <article className="card wide">
          <div className="cardTitle">
            <Bot size={22} />
            <h2>AI 설명</h2>
          </div>
          <ul>
            {sampleShipment.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <div className="chatBox">“이 선적이 왜 위험한지 쉽게 설명해줘”</div>
        </article>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
