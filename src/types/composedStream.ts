import {GenericResponse} from "@kwilteam/kwil-js/dist/core/resreq";
import {TxReceipt} from "@kwilteam/kwil-js/dist/core/tx";
import {IStream, StreamLocator} from "./stream";

export interface IComposedStream extends IStream {
    /**
     * returns the taxonomy of the stream
     */
    describeTaxonomies(params: DescribeTaxonomiesParams): Promise<Taxonomy>;
    /**
     * sets the taxonomy of the stream
     */
    setTaxonomy(taxonomies: Taxonomy): Promise<GenericResponse<TxReceipt>>;
}

export interface Taxonomy {
    taxonomyItems: TaxonomyItem[];
    startDate?: Date;
}

export interface TaxonomyItem {
    childStream: StreamLocator;
    weight: number;
}

export interface DescribeTaxonomiesParams {
    /**
     * if true, will return the latest version of the taxonomy only
     */
    latestVersion: boolean;
}