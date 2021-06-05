const https = require('https')
const cheerio = require('cheerio');

const neo4j = require('neo4j-driver')

const stopWords = [
    'ancient Greece',
    'Rome',
    'Mexico',
    'Tabasco',
    'Skin irritation',
    'vitamin C',
    'South Pacific',
    'citation needed',
    'morphine',
    'oil',
    'Aqueous',
    'extracts',
    'Native Americans',
    'American Cancer Society',
    'Kalahari',
    'San',
    'Philippines',
    'Chumash people',
    'Greek',
    'ancient Roman',
    'Native Americans',
    'Digoxin',
    'a',
    'Middle Ages',
];

const bioTags = [
    "Kingdom",
    "Clade",
    "Order",
    "Family",
    "Subfamily",
    "Tribe",
    "Genus"
]

var herbs = {};

const herbOptions = {
    hostname: 'en.wikipedia.org',
    port: 443,
    path: '/wiki/List_of_plants_used_in_herbalism',
    method: 'GET'
}

const herbBadEffectsOptions = {
    hostname: 'en.wikipedia.org',
    port: 443,
    path: '/wiki/List_of_herbs_with_known_adverse_effects',
    method: 'GET'
}

const herbInfo = {
    hostname: 'en.wikipedia.org',
    port: 443,
    method: 'GET'
}

async function request(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            // console.log(`statusCode: ${res.statusCode}`);

            const data = [];

            res.on('data', chunk => {
                data.push(chunk);
            });

            res.on('end', () => resolve(Buffer.concat(data).toString()));

            res.on('error', (error) => {
                // promise rejected on error
                reject(error);
            });

        })

        req.on('error', reject);

        // IMPORTANT
        req.end();
    })
}

(async function () {
    let herbs = {};

    let herbsHtmlWikipedia = await request(herbOptions);
    var $ = cheerio.load(herbsHtmlWikipedia);
    $('table.wikitable tr').each(async (j, tr) => {
        let herb = {};
        $('td', $(tr).html()).each((i, td) => {
            if (i == 0) {
                herb.latin = $('a', $(td).html()).text();
                herb.link = "https://en.wikipedia.org" + $('a', $(td).html()).attr('href');
                herb.path = $('a', $(td).html()).attr('href');
            }
            if (i == 1) {
                herb.name = $('a', $(td).html()).text();
            }
            if (i == 2) {
                let effects = [];
                $('a', $(td).html()).each((i, a) => {
                    var text = $(a).text();
                    var patt = new RegExp("[a-zA-Z]");
                    if (patt.test(text) && !stopWords.includes(text)) {
                        effects.push(text.toLocaleLowerCase());
                    }
                })
                herb.effects = effects;
            }
        })

        let infos = [];
        let herbInfoRequest = await request({ ...herbInfo, path: herb.path });
        $1 = cheerio.load(herbInfoRequest);
        $1('tr', $1('table.infobox.biota').html()).each(async (j, tr) => {
            let info = {
                tag: '',
                value: '',
                related: []
            };
            $1('td', $1(tr).html()).each((i, td) => {
                let text = $1(td).text().trim();
                text = text.replace(/\W\d*/g, '');

                if (i == 0) {
                    if (bioTags.includes(text)) {
                        info.tag = text
                        console.log(text);
                    }
                }
                if (i == 1) {
                    if (info.tag) {
                        info.value = text;
                        if (infos[infos.length - 1]) {
                            info.related.push({ name: 'included_in', value: infos[infos.length - 1].value, tag: infos[infos.length - 1].tag });
                        }
                        // infos.forEach(element => {
                        //     info.related.push({ name: 'included_in', value: element.value, tag: element.tag });
                        // });

                        infos.push(info);
                    }
                }
            })
        });
        herb.infos = infos;

        if (herb.infos.length) {
            herbs[herb.latin] = herb;
        }

        // console.log(herb);
    });

    let herbsBadEffectsHtmlWikipedia = await request(herbBadEffectsOptions);
    $ = cheerio.load(herbsBadEffectsHtmlWikipedia);
    $('tr', $('table.wikitable').html()).each(async (j, tr) => {
        let herb = {};
        var adverseEffect = [];
        $('td', $(tr).html()).each((i, td) => {
            if (i == 2) {
                $('a', $(td).html()).each((i, a) => {
                    var text = $(a).text();
                    var patt = new RegExp("[a-zA-Z]");
                    if (patt.test(text) && !stopWords.includes(text)) {
                        herb.name = text;
                    }
                })
            }
            if (i == 3) {

                let text = $(td).text();
                let effects = text.split(',');
                if (effects.length > 0) {
                    effects.forEach(effect => {
                        var patt = new RegExp("[a-zA-Z]");
                        if (countWords(effect) < 3 && patt.test(effect)) {
                            adverseEffect.push(effect.replace(/[^a-zA-Z ]/g, '').toLowerCase().trim());
                        }
                    });
                }
                herb.adverseEffect = adverseEffect;
            }
        })



        if (herbs[herb.name] && herb.adverseEffect && herb.adverseEffect.length > 0) {
            herbs[herb.name].adverseEffect = adverseEffect;
        }


    });

    const driver = neo4j.driver("bolt://neo4j:7687", neo4j.auth.basic('neo4j', "password"));

    for (let index = 0; index < Object.keys(herbs).length; index++) {
        const herb = herbs[Object.keys(herbs)[index]];
        // console.log(herb);
        var session = driver.session();

        try {

            const result = await session.run(
                'CREATE (a:Herb {name: $latin, english: $english, link: $link}) RETURN a',
                { latin: herb.latin, english: herb.name, link: herb.link },
            )
        } catch (err) {
            console.error(err);
        } finally {
            await session.close()
        }

        asyncForEach(herb.effects, async effect => {
            var session = driver.session();

            try {
                const result = await session.run(
                    'MERGE (a:Disease {name: $effect}) RETURN a',
                    { effect: effect },
                )
            } catch (err) {
                console.error(err);
            } finally {
                await session.close()
            }

            var session = driver.session();

            try {
                const result = await session.run(
                    `MATCH
                        (a:Herb),
                        (b:Disease)
                    WHERE a.name = $herbName AND b.name = $diseaseName
                    MERGE (a)-[r:cures]->(b)
                    RETURN type(r)`,
                    { herbName: herb.latin, diseaseName: effect },
                )

            } catch (err) {
                console.error(err);
            } finally {
                await session.close()
            }
        })

        asyncForEach(herb.adverseEffect, async effect => {
            var session = driver.session();

            try {
                const result = await session.run(
                    'MERGE (a:Disease {name: $effect}) RETURN a',
                    { effect: effect },
                )
            } catch (err) {
                console.error(err);
            } finally {
                await session.close()
            }

            var session = driver.session();

            try {
                const result = await session.run(
                    `MATCH
                        (a:Herb),
                        (b:Disease)
                    WHERE a.name = $herbName AND b.name = $diseaseName
                    MERGE (a)-[r:cause]->(b)
                    RETURN type(r)`,
                    { herbName: herb.latin, diseaseName: effect },
                )

            } catch (err) {
                console.error(err);
            } finally {
                await session.close()
            }
        })

        asyncForEach(herb.infos, async (info, index) => {
            var session = driver.session();

            // try {
            //     const result = await session.run(
            //         `MERGE (a:${info.tag} {name: $value}) RETURN a`,
            //         { value: info.value.trim(), tag: info.tag },
            //     )
            // } catch (err) {
            //     console.error(err);
            // } finally {
            //     await session.close()
            // }

            var session = driver.session();

            if (info.value.substring(0, 4) == "Plan") {
                console.log(info);
            }

            if (info == herb.infos[herb.infos.length - 1]) {

                try {
                    const result = await session.run(
                    `MATCH
                        (a:Herb),
                        (b:${info.tag})
                    WHERE a.name = $herbName AND b.name = $value
                    MERGE  (a)-[r:included_in]->(b)
                    ON CREATE SET b.created = ${index}
                    RETURN type(r)`,
                        { herbName: herb.latin, value: info.value.trim(), tag: info.tag },
                    )

                } catch (err) {
                    console.error(err);
                } finally {
                    await session.close()
                }
            }

            if (index > 0) {

                var session = driver.session();
                try {
                    const result = await session.run(
                        `MATCH
                            (a:${herb.infos[index - 1].tag} {name: $value}),
                            (b:${info.tag} {name: $parentValue})
                        MERGE (b)-[r:included_in]->(a)
                        ON CREATE SET b.created = ${index}, a.updated = ${index}
                        RETURN type(r)`,
                        {
                            value: herb.infos[index - 1].value.trim(),
                            tag: herb.infos[index - 1].tag,
                            parentValue: info.value.trim(),
                            parentTag: info.tag
                        },
                    )
                } catch (err) {
                    console.error(err);
                } finally {
                    await session.close()
                }
            }
        })
    }

    // on application exit:
    await driver.close()
})();

async function asyncForEach(array, callback) {
    if (array) {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    }
}

function countWords(str) {
    return str.split(' ').length;
}