import type { Metadata } from "next";
import Shell from "@/components/layout/Shell";
import { PRODUCT_NAME } from "@/lib/config/product";
import SoloBattle from "./SoloBattle";
import { SAMPLE_ITEMS } from "./sample-items";

export const metadata: Metadata = {
    title: `ひとりで対戦 - ${PRODUCT_NAME}`,
};

export default function Page() {
    return (
        <Shell title="ひとりで対戦" size="large" backLink="/">
            <SoloBattle items={SAMPLE_ITEMS} />
        </Shell>
    );
}
