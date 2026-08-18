import { flyToEmergency, mountControl } from "../map";
import { $ } from "../ui/dom";

type StatsCard = {
  reservedTop: () => number;
  show: () => void;
};

export function initEmergencyView(stats: StatsCard): void {
  const button = $("see-emergency");
  mountControl(button);
  button.addEventListener("click", () => {
    void flyToEmergency(stats.reservedTop()).then(stats.show);
  });
}
