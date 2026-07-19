import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeleteRequest, ScheduleDraft, ScheduleUpdate } from "../../shared/contracts";
import type { AppClient } from "../../shared/ipc/client";
import { dayRange } from "../../shared/time";

export function useSchedules(client: AppClient, date: Date, search: string) {
  const range = dayRange(date);
  return useQuery({
    queryKey: ["schedules", range.startUtc, range.endUtc, search],
    queryFn: () => client.listSchedules({ ...range, search, limit: 500 }),
    staleTime: 15_000,
  });
}

export function useScheduleActions(client: AppClient) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["schedules"] });

  return {
    create: useMutation({
      mutationFn: (draft: ScheduleDraft) => client.createSchedule(draft),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (update: ScheduleUpdate) => client.updateSchedule(update),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (request: DeleteRequest) => client.deleteSchedule(request),
      onSuccess: refresh,
    }),
    undo: useMutation({ mutationFn: () => client.undo(), onSuccess: refresh }),
    redo: useMutation({ mutationFn: () => client.redo(), onSuccess: refresh }),
  };
}
