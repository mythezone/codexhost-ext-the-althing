import { useEffect, useMemo, useRef, useState } from "react";
import { useL, useWorkspace } from "./context";
import { reportDocument } from "../shared/report-document";
import { Modal } from "./ui";
import { saveBlob } from "./rpc-client";
import type { Report } from "./types";
export function ReportReader({
  topicId,
  id,
  close,
}: {
  topicId: string;
  id: string;
  close: () => void;
}) {
  const l = useL(),
    { rpc, scheme, locale } = useWorkspace(),
    frame = useRef<HTMLIFrameElement>(null);
  const [report, set] = useState<Report>(),
    [error, fail] = useState("");
  useEffect(() => {
    let live = true;
    rpc
      .call<Report>("reports/get", {
        topicId,
        reportId: id,
        ...(locale && { locale }),
      })
      .then((r) => {
        if (live) set(r);
      })
      .catch((e) => {
        if (live) fail(e.message);
      });
    return () => {
      live = false;
    };
  }, [rpc, topicId, id, locale]);
  const html = useMemo(
    () =>
      report?.html_content &&
      reportDocument(report.html_content, scheme === "dark"),
    [report?.html_content, scheme],
  );
  return (
    <Modal title={report?.title || l("Report", "报告")} close={close} wide>
      <div className="tools report-tools">
        <button
          disabled={!html}
          onClick={() =>
            frame.current?.contentWindow?.postMessage("althing.print", "*")
          }
        >
          {l("Print / PDF", "打印 / PDF")}
        </button>
        <button
          disabled={!html}
          onClick={() =>
            saveBlob(new Blob([html!], { type: "text/html" }), id + ".html")
          }
        >
          {l("Download HTML", "下载 HTML")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {html && (
        <iframe
          className="report-frame"
          title={report!.title}
          sandbox="allow-scripts allow-modals"
          ref={frame}
          srcDoc={html}
        />
      )}
    </Modal>
  );
}
