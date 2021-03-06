import * as TypeORM from 'typeorm'
import { GraphQLResolveInfo } from 'graphql'

import { getRelationsForQuery, graphQLObjectValueToObject } from './util'
import { TypeGraphORMField, getDatabaseObjectMetadata } from '.'
import { translateWhereClause, Where } from './where'
import { orderNamesToOrderInfos, OrderInfo } from './order'

function addSubqueries(
  qb: TypeORM.SelectQueryBuilder<any>,
  fields: TypeGraphORMField<any, any>[],
  alias: string,
  ctx: any,
) {
  fields.forEach(field => {
    if (field.addSelect) {
      qb.addSelect(
        sq => field.addSelect!(sq, ctx || {}, alias),
        `${alias}_${field.propertyKey}`,
      )
    }
  })
}

export async function resolve({
  entity,
  where,
  info,
  take,
  skip,
  orders,
  ids,
  ctx,
}: {
  entity: any
  info: GraphQLResolveInfo
  where?: Where
  skip?: number
  take?: number
  orders?: OrderInfo[]
  ids?: any[]
  ctx: any
}) {
  const meta = getDatabaseObjectMetadata(entity.prototype)
  const _conn = TypeORM.getConnection()
  const typeormMetadata = _conn.getMetadata(entity)
  const { name } = typeormMetadata
  const relations = getRelationsForQuery(entity, info)
  const ordersWithDepth: {
    alias: string
    depth: number
    order: OrderInfo
  }[] = orders && orders.map(order => ({
    alias: name,
    depth: 0,
    order,
  })) || []

  const qb = _conn.getRepository(entity).createQueryBuilder()

  relations.forEach(relation => {
    if (typeof relation.type === 'string') {
      // TODO: support string typed relation
      throw new Error(`String typed relation is not supported yet.`)
    } else {
      const relationMeta = getDatabaseObjectMetadata(relation.type.prototype)

      const entities = relation.relationPath.split('.')
      const depth = entities.length

      const lastPath = entities[entities.length - 1]
      const prevEntities = [typeormMetadata.name].concat(entities.slice(0, entities.length - 1))

      const joinPath = `${prevEntities.join('_')}.${lastPath}`
      const alias = `${prevEntities.join('_')}_${lastPath}`

      addSubqueries(qb, relationMeta.fields, alias, ctx)

      const { arguments: fieldArgs } = relation.fieldNode

      if (fieldArgs) {
        const [clause, params] = (() => {
          const whereArg = fieldArgs.find(arg => arg.name.value === 'where')

          if (whereArg) {
            const whereArgObject = graphQLObjectValueToObject(whereArg.value)
            return translateWhereClause(
              alias,
              whereArgObject,
              relation.relationPath,
            )
          }
          return []
        })()
        qb.leftJoinAndSelect(joinPath, alias, clause, params)

        const orderByArg = fieldArgs.find(arg => arg.name.value === 'orderBy')

        if (orderByArg) {
          const orderByArgObject = graphQLObjectValueToObject(orderByArg.value)
          const orderByNames = orderByArgObject instanceof Array ? orderByArgObject : [orderByArgObject]
          const orders = orderNamesToOrderInfos(orderByNames)
          orders.forEach(order => {
            if (order) {
              ordersWithDepth.push({
                alias,
                depth,
                order,
              })
            }
          })
        }
      }
    }
  })

  addSubqueries(qb, meta.fields, typeormMetadata.name, ctx)

  if (ids) {
    if (ids.length === 0) {
      return []
    }

    if (!typeormMetadata.hasMultiplePrimaryKeys) {
      const [primaryColumn] = typeormMetadata.primaryColumns
      if (primaryColumn) {
        const idsKey = '__IDS'
        qb.andWhere(
          `${typeormMetadata.name}.${primaryColumn.propertyName} IN (:...${idsKey})`,
          { [idsKey]: ids },
        )
      }
    }
  } else if (where) {
    const [ clause, params ] = where
    qb.where(clause, params)
  }

  const sortedOrdersWithDepth = ordersWithDepth.sort((a, b) => a.depth - b.depth)

  sortedOrdersWithDepth.forEach(order => {
    const { alias, order: { propertyName, type } } = order
    qb.addOrderBy(`${alias}.${propertyName}`, type)
  })

  if (take) {
    qb.take(take)
  }

  if (skip) {
    qb.skip(skip)
  }

  if (process.env.__TGO_SHOW_SQL) {
    console.log(qb.getQueryAndParameters())  // eslint-disable-line no-console
  }

  return qb.getMany()
}

export async function resolveSingleField(
  fieldName: string,
  entity: any,
  source: any,
  ctx: any,
  info: GraphQLResolveInfo,
) {
  if (
    fieldName in source &&
    source[fieldName] !== null &&
    typeof source[fieldName] !== 'undefined'
  ) {
    return source[fieldName]
  }

  const conn = TypeORM.getConnection()
  const typeormMetadata = conn.getMetadata(entity)

  const { relations } = typeormMetadata
  const relation = relations.find(relation => relation.propertyName === fieldName)

  if (relation) {
    const relationTypeormMetadata = conn.getMetadata(relation.type)

    if (relationTypeormMetadata.primaryColumns.length === 1) {
      const [primaryColumnMeta] = relationTypeormMetadata.primaryColumns
      const idColumnName = primaryColumnMeta.propertyName
      const idColumnNameInRelation = `${relationTypeormMetadata.name}.${idColumnName}`

      const data: any = await conn.getRepository(entity).findOne({
        relations: [fieldName],
        where: source,
      })

      if (data && data[fieldName]) {
        if (relation.relationType === 'many-to-one' || relation.relationType === 'one-to-one') {
          const relatedEntry: any = data[fieldName]

          const result = await resolve({
            entity: relation.type,
            info,
            where: [`${idColumnNameInRelation} = :id`, {id: relatedEntry[idColumnName]}],
            ctx,
          })

          if (result && result.length > 0) {
            return result[0]
          }
        } else if (relation.relationType === 'one-to-many') {
          const relatedEntries: any[] = data[fieldName]
          const targetIds: any[] = relatedEntries.map(entry => entry[idColumnName])

          return resolve({
            entity: relation.type,
            info,
            where: [`${idColumnNameInRelation} IN (:...ids)`, {ids: targetIds}],
            ctx,
          })
        }
      }
    }
  } else {
    const databaseObjectMetadata = getDatabaseObjectMetadata(entity.prototype)
    const field = databaseObjectMetadata.fields.find(_field => _field.propertyKey === fieldName)

    if (field && field.addSelect) {
      const alias = 'SUBQUERY'
      const targetColumnName = 'TARGET'
      const data: any = await conn.getRepository(entity)
        .createQueryBuilder(alias)
        .addSelect(sq => field.addSelect!(sq, ctx, alias), targetColumnName)
        .getRawOne()
      return data[targetColumnName]
    } else {
      const data: any = await conn.getRepository(entity).findOne({
        where: source,
      })

      return data && data[fieldName]
    }
  }
}
