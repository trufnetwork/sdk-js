import { NodeTNClient, StreamId, StreamType, TaxonomySet } from '@trufnetwork/sdk-js';
import { Wallet } from 'ethers';

// Hardcoded private key for demonstration, use your own private key on production
const wallet = new Wallet("0000000000000000000000000000000000000000000000000000000000000001");

const client = new NodeTNClient({
    endpoint: "http://localhost:8484", // Adjusted to use local node, you can also use the mainnet endpoint if needed
    signerInfo: {
        address: wallet.address,
        signer: wallet,
    },
    chainId: "",
});

async function main() {
    // Generate stream IDs
    const priceStreamId1 = await StreamId.generate('commodity_price_1');
    const priceStreamId2 = await StreamId.generate('commodity_price_2');
    const compositeIndexStreamId = await StreamId.generate('commodity_composite_index');

    try {
        // 1. Deploy Primitive Streams
        const deployTx1 = await client.deployStream(priceStreamId1, StreamType.Primitive);
        if (!deployTx1.data) throw new Error('Deploy Tx1 failed');
        await client.waitForTx(deployTx1.data.tx_hash);

        const deployTx2 = await client.deployStream(priceStreamId2, StreamType.Primitive);
        if (!deployTx2.data) throw new Error('Deploy Tx2 failed');
        await client.waitForTx(deployTx2.data.tx_hash);

        // 2. Deploy Composed Stream
        const deployComposedTx = await client.deployStream(compositeIndexStreamId, StreamType.Composed);
        if (!deployComposedTx.data) throw new Error('Deploy Composed Tx failed');
        await client.waitForTx(deployComposedTx.data.tx_hash);

        // 3. Load Actions
        const primitiveAction1 = client.loadPrimitiveAction();
        const primitiveAction2 = client.loadPrimitiveAction();
        const composedAction = client.loadComposedAction();
        const streamAction = client.loadAction();

        // 4. Insert Records into Primitive Streams
        const insertTx1 = await primitiveAction1.insertRecord({
            stream: client.ownStreamLocator(priceStreamId1),
            eventTime: Date.now(),
            value: "50.75"
        });
        if (!insertTx1.data) throw new Error('Insert Tx1 failed');
        await client.waitForTx(insertTx1.data.tx_hash);

        const insertTx2 = await primitiveAction2.insertRecord({
            stream: client.ownStreamLocator(priceStreamId2),
            eventTime: Date.now(),
            value: "75.25"
        });
        if (!insertTx2.data) throw new Error('Insert Tx2 failed');
        await client.waitForTx(insertTx2.data.tx_hash);

        // 5. Set Stream Taxonomy (Composed Stream)
        const taxonomyData: TaxonomySet = {
            stream: client.ownStreamLocator(compositeIndexStreamId),
            taxonomyItems: [
                {
                    childStream: client.ownStreamLocator(priceStreamId1),
                    weight: "0.6"
                },
                {
                    childStream: client.ownStreamLocator(priceStreamId2),
                    weight: "0.4"
                }
            ],
            startDate: Date.now()
        };
        const taxonomyTx = await composedAction.setTaxonomy(taxonomyData);
        if (!taxonomyTx.data) throw new Error('Taxonomy Tx failed');
        await client.waitForTx(taxonomyTx.data.tx_hash);

        // 6. Read Stream Data
        const primitiveRecords1 = await streamAction.getRecord({
            stream: client.ownStreamLocator(priceStreamId1)
        });
        console.log('Primitive Stream 1 Records:', primitiveRecords1);

        const primitiveRecords2 = await streamAction.getRecord({
            stream: client.ownStreamLocator(priceStreamId2)
        });
        console.log('Primitive Stream 2 Records:', primitiveRecords2);

        // 7. Get Composed Stream Taxonomy
        const taxonomy = await composedAction.describeTaxonomies({
            stream: client.ownStreamLocator(compositeIndexStreamId),
            latestGroupSequence: true
        });
        console.log('Composed Stream Taxonomy:', JSON.stringify(taxonomy, null, 2));

        // 8. Clean Up: Destroy Streams
        const destroyTx1 = await client.destroyStream(client.ownStreamLocator(priceStreamId1));
        if (!destroyTx1.data) throw new Error('Destroy Tx1 failed');
        await client.waitForTx(destroyTx1.data.tx_hash);

        const destroyTx2 = await client.destroyStream(client.ownStreamLocator(priceStreamId2));
        if (!destroyTx2.data) throw new Error('Destroy Tx2 failed');
        await client.waitForTx(destroyTx2.data.tx_hash);

        const destroyComposedTx = await client.destroyStream(client.ownStreamLocator(compositeIndexStreamId));
        if (!destroyComposedTx.data) throw new Error('Destroy Composed Tx failed');
        await client.waitForTx(destroyComposedTx.data.tx_hash);

        console.log('✅ Stream lifecycle demonstration complete!');
    } catch (error) {
        console.error('❌ Error in stream lifecycle:', error);
    }
}

// Run the main function
main().catch(console.error); 