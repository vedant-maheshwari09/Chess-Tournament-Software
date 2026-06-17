import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { pool } from './server/db';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

class PostgresQueryBuilder {
  private table: string;
  private operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private values: Record<string, any> = {};
  private conditions: Array<{ column: string; value: any }> = [];
  private orderCol: string | null = null;
  private orderAscending = true;
  private isSingle = false;
  private isMaybeSingle = false;

  constructor(table: string) {
    this.table = table;
  }

  insert(values: any) {
    this.operation = 'insert';
    this.values = values;
    return this;
  }

  update(values: any) {
    this.operation = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  select(columns?: string) {
    if (this.operation === 'select') {
      this.operation = 'select';
    }
    return this;
  }

  eq(column: string, value: any) {
    this.conditions.push({ column, value });
    return this;
  }

  order(column: string, { ascending }: { ascending?: boolean } = {}) {
    this.orderCol = column;
    this.orderAscending = ascending ?? true;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    try {
      const result = await this.execute();
      return onfulfilled ? onfulfilled(result) : result;
    } catch (error) {
      if (onrejected) {
        return onrejected(error);
      }
      throw error;
    }
  }

  private async execute() {
    let queryText = '';
    const params: any[] = [];

    if (this.operation === 'insert') {
      const keys = Object.keys(this.values);
      const valPlaceholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      params.push(...Object.values(this.values));
      queryText = `INSERT INTO "${this.table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${valPlaceholders}) RETURNING *`;
    } 
    else if (this.operation === 'update') {
      const keys = Object.keys(this.values);
      const setClauses = keys.map((key, i) => `"${key}" = $${i + 1}`).join(', ');
      params.push(...Object.values(this.values));

      const whereClauses: string[] = [];
      this.conditions.forEach((cond) => {
        params.push(cond.value);
        whereClauses.push(`"${cond.column}" = $${params.length}`);
      });

      queryText = `UPDATE "${this.table}" SET ${setClauses}`;
      if (whereClauses.length > 0) {
        queryText += ` WHERE ${whereClauses.join(' AND ')}`;
      }
      queryText += ' RETURNING *';
    } 
    else if (this.operation === 'delete') {
      const whereClauses: string[] = [];
      this.conditions.forEach((cond) => {
        params.push(cond.value);
        whereClauses.push(`"${cond.column}" = $${params.length}`);
      });

      queryText = `DELETE FROM "${this.table}"`;
      if (whereClauses.length > 0) {
        queryText += ` WHERE ${whereClauses.join(' AND ')}`;
      }
      queryText += ' RETURNING *';
    } 
    else {
      // select
      queryText = `SELECT * FROM "${this.table}"`;
      const whereClauses: string[] = [];
      this.conditions.forEach((cond) => {
        params.push(cond.value);
        whereClauses.push(`"${cond.column}" = $${params.length}`);
      });

      if (whereClauses.length > 0) {
        queryText += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      if (this.orderCol) {
        queryText += ` ORDER BY "${this.orderCol}" ${this.orderAscending ? 'ASC' : 'DESC'}`;
      }
    }

    try {
      const res = await pool.query(queryText, params);
      const rows = res.rows;

      if (this.isSingle) {
        if (rows.length === 0) {
          return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
        }
        return { data: rows[0], error: null };
      }

      if (this.isMaybeSingle) {
        return { data: rows.length > 0 ? rows[0] : null, error: null };
      }

      return { data: rows, error: null };
    } catch (err: any) {
      console.error(`PostgresQueryBuilder error on ${queryText}:`, err);
      return { data: null, error: { message: err.message, code: err.code || 'UNKNOWN' } };
    }
  }
}

let fallbackLogged = false;
export function getSupabaseClient() {
  if (supabase) {
    return supabase;
  }
  if (!fallbackLogged) {
    console.log("ℹ️ getSupabaseClient: falling back to direct Postgres pool client shim");
    fallbackLogged = true;
  }
  return {
    from: (table: string) => new PostgresQueryBuilder(table)
  } as any;
}
