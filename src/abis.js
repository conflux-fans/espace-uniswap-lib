import ERC20ABI from '../abis/erc20.json' with { type: 'json' };
import WEHT9Meta from '../abis/WETH9.json' with { type: 'json' };

import Router02Meta from '../abis/IUniswapV2Router02.json' with { type: 'json' };
import FactoryMeta  from '../abis/IUniswapV2Factory.json' with { type: 'json' };
import PairMeta from '../abis/IUniswapV2Pair.json' with { type: 'json' };

import UniswapV3PoolMeta from '../abis/IUniswapV3Pool.json' with { type: 'json' };
import UniswapV3FactoryMeta from '../abis/UniswapV3Factory.json' with { type: 'json' };
import UniswapV3RouterMeta from '../abis/UniswapV3SwapRouter.json' with { type: 'json' };
import UniswapV3PositionManagerMeta from '../abis/NonfungiblePositionManager.json' with { type: 'json' };

import IUniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json' with { type: 'json' };
import QuoterV2 from '@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json' with { type: 'json' };
import Quoter from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json' with { type: 'json' };
import INONFUNGIBLE_POSITION_MANAGER from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json' with { type: 'json' };

import Multicall3ABI from '../abis/Multicall3.json' with { type: 'json' };

export const WETH9ABI = WEHT9Meta.abi;

// uniswap v2 abis
export const PairABI = PairMeta.abi;
export const Router02ABI = Router02Meta.abi;
export const FactoryABI = FactoryMeta.abi;

// uniswap v3 abis
export const UniswapV3PoolABI = UniswapV3PoolMeta.abi;
export const UniswapV3FactoryABI = UniswapV3FactoryMeta.abi;
export const UniswapV3RouterABI = UniswapV3RouterMeta.abi;
export const UniswapV3PositionManagerABI = UniswapV3PositionManagerMeta.abi;

export const IUniswapV3PoolABI = IUniswapV3Pool.abi;
export const QuoterV2ABI = QuoterV2.abi;
export const QuoterABI = Quoter.abi;


export { ERC20ABI, Multicall3ABI };
