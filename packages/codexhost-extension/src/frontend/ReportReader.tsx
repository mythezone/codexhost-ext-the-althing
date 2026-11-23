import { useEffect, useRef, useState } from "react";
import { useL, useWorkspace } from "./context";
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
    { rpc, scheme } = useWorkspace(),
    frame = useRef<HTMLIFrameElement>(null);
  const [report, set] = useState<Report>(),
    [error, fail] = useState("");
  useEffect(() => {
    let live = true;
    rpc
      .call<Report>("reports/get", { topicId, reportId: id })
      .then((r) => {
        if (live) set(r);
      })
      .catch((e) => {
        if (live) fail(e.message);
      });
    return () => {
      live = false;
    };
  }, [rpc, topicId, id]);
  // Only the generated report document receives the initial appearance.
  const html = report?.html_content?.replace(
    /<html\b/i,
    scheme === "dark" ? "<html data-dark" : "<html",
  );
  return (
    <Modal title={report?.title || l("Report", "报告")} close={close} wide>
      <div className="tools">
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
