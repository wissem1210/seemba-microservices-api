"use strict";

const { MoleculerClientError } = require("moleculer").Errors;
const { ForbiddenError } = require("moleculer-web").Errors;

const _ = require("lodash");
const slug = require("slug");
const DbService = require("../mixins/db.mixin");
const CacheCleanerMixin = require("../mixins/cache.cleaner.mixin");

module.exports = {
    name: "games",
    mixins: [
        DbService("games"),
        CacheCleanerMixin([

            "cache.clean.users",

        ])
    ],

    /**
     * Default settings
     */
    settings: {
        rest: "games/",

        fields: ["_id", "name", "description", "createdAt", "updatedAt", "creator"],

        // Populates
        populates: {
            author: {
                action: "users.get",
                params: {
                    fields: ["username", "bio", "image"]
                }
            },


        },

        // Validation schema for new entities
        entityValidator: {
            name: { type: "string", min: 1 },
            description: { type: "string", min: 1 },
        }
    },

    /**
     * Actions
     */
    actions: {

        /**
         * Create a new game.
         * Auth is required!
         *
         * @actions
         * @param {Object} game - Game entity
         *
         * @returns {Object} Created entity
         */
        create: {
            auth: "required",
            rest: "POST /",
            params: {
                game: { type: "object" }
            },
            async handler(ctx) {
                let entity = ctx.params.game;
                await this.validateEntity(entity);

                entity.slug = slug(entity.name, { lower: true }) + "-" + (Math.random() * Math.pow(36, 6) | 0).toString(36);
                entity.creator = ctx.meta.user._id.toString();
                entity.createdAt = new Date();
                entity.updatedAt = new Date();

                const doc = await this.adapter.insert(entity);
                let json = await this.transformDocuments(ctx, { populate: ["creator"] }, doc);
                json = await this.transformResult(ctx, json, ctx.meta.user);
                await this.entityChanged("created", json, ctx);
                return json;
            }
        },

        /**
         * Update a game.
         * Auth is required!
         *
         * @actions
         * @param {String} id - Game ID
         * @param {Object} game - Game modified fields
         *
         * @returns {Object} Updated entity
         */
        update: {
            auth: "required",
            rest: "PUT /:id",
            params: {
                id: { type: "string" },
                game: {
                    type: "object",
                    props: {
                        name: { type: "string", min: 1, optional: true },
                        description: { type: "string", min: 1, optional: true },
                    }
                }
            },
            async handler(ctx) {
                let newData = ctx.params.game;
                newData.updatedAt = new Date();
                // the 'id' is the slug
                //const game = await this.findBySlug(ctx.params.id);
                const game = await this.getById(ctx.params.id);
                if (!game)
                    throw new MoleculerClientError("Game not found", 404);

                if (game.creator !== ctx.meta.user._id.toString())
                    throw new ForbiddenError();

                const update = {
                    "$set": newData
                };

                const doc = await this.adapter.updateById(game._id, update);
                const entity = await this.transformDocuments(ctx, { populate: ["creator"] }, doc);
                const json = await this.transformResult(ctx, entity, ctx.meta.user);
                this.entityChanged("updated", json, ctx);
                return json;
            }
        },

        /**
         * List games with pagination.
         *
         * @actions
         * @param {String} creator - Filter for creator ID
         * @param {Number} limit - Pagination limit
         * @param {Number} offset - Pagination offset
         *
         * @returns {Object} List of games
         */
        list: {
            cache: {
                keys: ["#userID", "creator", "limit", "offset"]
            },
            rest: "GET /",
            params: {
                creator: { type: "string", optional: true },
                limit: { type: "number", optional: true, convert: true },
                offset: { type: "number", optional: true, convert: true },
            },
            async handler(ctx) {
                const limit = ctx.params.limit ? Number(ctx.params.limit) : 20;
                const offset = ctx.params.offset ? Number(ctx.params.offset) : 0;

                let params = {
                    limit,
                    offset,
                    sort: ["-createdAt"],
                    populate: ["creator"],
                    query: {}
                };
                let countParams;

                if (ctx.params.tag)
                    params.query.tagList = { "$in": [ctx.params.tag] };

                /*
                if (ctx.params.author) {
                	const users = await ctx.call("users.find", { query: { username: ctx.params.author } });
                	if (users.length == 0)
                		throw new MoleculerClientError("Author not found");
                	params.query.author = users[0]._id;
                }
                if (ctx.params.favorited) {
                	const users = await ctx.call("users.find", { query: { username: ctx.params.favorited } });
                	if (users.length == 0)
                		throw new MoleculerClientError("Author not found");
                	const list = await ctx.call("favorites.find", { fields: ["article"], query: { user: users[0]._id } });
                	params.query._id = { $in: list.map(o => o.article) };
                }
                */

                countParams = Object.assign({}, params);
                // Remove pagination params
                if (countParams && countParams.limit)
                    countParams.limit = null;
                if (countParams && countParams.offset)
                    countParams.offset = null;

                const res = await this.Promise.all([
                    // Get rows
                    this.adapter.find(params),

                    // Get count of all rows
                    this.adapter.count(countParams)

                ]);

                const docs = await this.transformDocuments(ctx, params, res[0]);
                const r = await this.transformResult(ctx, docs, ctx.meta.user);
                r.gamesCount = res[1];
                return r;
            }
        },

        /**
         * List of games by creator.
         *
         * @actions
         * @param {String} creator - Creator ID
         * @param {Number} limit - Pagination limit
         * @param {Number} offset - Pagination offset
         *
         * @returns {Object} List of games
         */
        listByUser: {
            cache: {
                keys: ["#userID", "game", "limit", "offset"]
            },
            params: {
                creator: { type: "string" },
                limit: { type: "number", optional: true, convert: true },
                offset: { type: "number", optional: true, convert: true },
            },
            async handler(ctx) {
                const limit = ctx.params.limit ? Number(ctx.params.limit) : 20;
                const offset = ctx.params.offset ? Number(ctx.params.offset) : 0;

                let params = {
                    limit,
                    offset,
                    sort: ["-createdAt"],
                    populate: ["creator"],
                    query: {
                        game: ctx.params.creator
                    }
                };
                let countParams;

                countParams = Object.assign({}, params);
                // Remove pagination params
                if (countParams && countParams.limit)
                    countParams.limit = null;
                if (countParams && countParams.offset)
                    countParams.offset = null;

                const res = await this.Promise.all([
                    // Get rows
                    this.adapter.find(params),

                    // Get count of all rows
                    this.adapter.count(countParams)

                ]);

                const docs = await this.transformDocuments(ctx, params, res[0]);
                const r = await this.transformResult(ctx, docs, ctx.meta.user);
                r.commentsCount = res[1];
                return r;
            }
        },





        /**
         * Remove a game by slug
         * Auth is required!
         *
         * @actions
         * @param {String} id - Game slug
         *
         * @returns {Number} Count of removed articles
         */
        remove: {
            auth: "required",
            rest: "DELETE /:id",
            params: {
                id: { type: "any" }
            },
            async handler(ctx) {
                const entity = await this.findBySlug(ctx.params.id);
                if (!entity)
                    throw new MoleculerClientError("Game not found!", 404);

                if (entity.creator !== ctx.meta.user._id.toString())
                    throw new ForbiddenError();



                // Remove game entity
                const res = await this.adapter.removeById(entity._id);
                await this.entityChanged("removed", res, ctx);

                return res;
            }
        },




    },

    /**
     * Methods
     */
    methods: {
        /**
         * Find an game by slug
         *
         * @param {String} slug - Game slug
         *
         * @results {Object} Promise<game>
         */
        findBySlug(slug) {
            return this.adapter.findOne({ slug });
        },

        /**
         * Transform the result entities to follow the RealWorld API spec
         *
         * @param {Context} ctx
         * @param {Array} entities
         * @param {Object} user - Logged in user
         */
        async transformResult(ctx, entities, user) {
            if (Array.isArray(entities)) {
                const games = await this.Promise.all(entities.map(item => this.transformEntity(ctx, item, user)));
                return {
                    games
                };
            } else {
                const game = await this.transformEntity(ctx, entities, user);
                return { game };
            }
        },

        /**
         * Transform a result entity to follow the RealWorld API spec
         *
         * @param {Context} ctx
         * @param {Object} entity
         * @param {Object} user - Logged in user
         */
        async transformEntity(ctx, entity, user) {
            if (!entity) return null;

            return entity;
        }
    }
};