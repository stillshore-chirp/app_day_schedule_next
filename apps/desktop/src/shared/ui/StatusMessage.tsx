interface StatusMessageProps {
  tone?: "neutral" | "success" | "warning" | "danger";
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}

export function StatusMessage({ tone = "neutral", title, children, action }: StatusMessageProps) {
  return (
    <section
      className={`status-message status-message--${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
      {action}
    </section>
  );
}
