import { redirect } from "next/navigation";
import Shell from "@/components/layout/Shell";
import { getRoomItems } from "@/lib/item";
import { getPlaygroundRoom } from "@/lib/room/playground";
import SoloBattle from "../../solo/SoloBattle";

export default async function RoomSoloPage({
    params,
}: {
    params: Promise<{ link: string }>;
}) {
    const [{ link }, room] = await Promise.all([params, getPlaygroundRoom()]);
    const roomPath = "/" + encodeURIComponent(link);
    if (!room) redirect(roomPath);

    const canonicalLink = room.link ?? room.id;
    if (link !== canonicalLink) {
        if (link === room.id) redirect("/" + encodeURIComponent(canonicalLink) + "/solo");
        redirect(roomPath);
    }

    return (
        <Shell title={room.title || "ひとりで対戦"} size="large" backLink={roomPath}>
            <SoloBattle key={room.id} roomId={room.id} items={getRoomItems(room)} />
        </Shell>
    );
}
